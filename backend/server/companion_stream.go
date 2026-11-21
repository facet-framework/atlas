package server

import (
	"encoding/json"
	"path/filepath"
	"strconv"
	"strings"
)

// streamLine is the part of Claude Code's stream-json shape this reads.
type streamLine struct {
	Type    string `json:"type"`
	Subtype string `json:"subtype"`
	Message struct {
		Content []struct {
			Type  string          `json:"type"`
			Text  string          `json:"text"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		} `json:"content"`
		Model string `json:"model"`
	} `json:"message"`
	SessionID string  `json:"session_id"`
	Cost      float64 `json:"total_cost_usd"`
	Result    string  `json:"result"`
	IsError   bool    `json:"is_error"`
	Turns     int     `json:"num_turns"`
	Status    string  `json:"status"`
	Tokens    int     `json:"estimated_tokens"`
	// Event carries the partial message chunks, which is where reasoning and
	// prose arrive while they are being written rather than once they are done.
	Event struct {
		Type  string `json:"type"`
		Delta struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			Thinking string `json:"thinking"`
		} `json:"delta"`
	} `json:"event"`
}

// decodeStreamLine turns one line of the agent's stream into steps worth
// showing. Lines that carry no news, and there are several kinds, yield none.
func decodeStreamLine(line []byte, root string) []CompanionStep {
	var parsed streamLine
	if err := json.Unmarshal(line, &parsed); err != nil {
		return nil
	}

	switch parsed.Type {
	case "stream_event":
		// Prose and reasoning arrive here, character by character. The finished
		// assistant message repeats them, which is why it is read only for the
		// tool calls below: everything else would arrive twice.
		if parsed.Event.Type != "content_block_delta" {
			return nil
		}
		switch parsed.Event.Delta.Type {
		case "text_delta":
			if parsed.Event.Delta.Text != "" {
				return []CompanionStep{{Kind: "text", Text: parsed.Event.Delta.Text}}
			}
		case "thinking_delta":
			if parsed.Event.Delta.Thinking != "" {
				return []CompanionStep{{Kind: "thinking", Text: parsed.Event.Delta.Thinking}}
			}
		}
		return nil
	case "system":
		switch parsed.Subtype {
		case "compact_boundary":
			// '/compact' works here, so the reader can offer it: a long
			// conversation is summarised rather than started over, which keeps
			// what was established and drops what was only scrolled past.
			return []CompanionStep{{Kind: "compacted", Text: "Conversation compacted"}}
		case "status":
			// What the agent is doing before it has anything to show.
			if parsed.Status != "" {
				return []CompanionStep{{Kind: "status", Text: parsed.Status}}
			}
		case "thinking_tokens":
			// The only honest progress during a long think: a measured count,
			// not a bar filling against a guessed clock.
			if parsed.Tokens > 0 {
				return []CompanionStep{{Kind: "status", Text: "thinking", Tokens: parsed.Tokens}}
			}
		}
		return nil
	case "assistant":
		var steps []CompanionStep
		for _, content := range parsed.Message.Content {
			switch content.Type {
			case "tool_use":
				// A blocked tool still appears here: the agent asks, and the
				// permission layer refuses afterwards. Showing the attempt would
				// tell the reader a file was consulted when nothing was, so only
				// the tools that can actually run are reported.
				if !isReadTool(content.Name) {
					continue
				}
				steps = append(steps, CompanionStep{
					Kind:   "read",
					Tool:   content.Name,
					Target: toolTarget(content.Input, root),
					Lines:  toolLines(content.Name, content.Input),
				})
			}
		}
		return steps
	case "result":
		if parsed.IsError || parsed.Subtype != "success" {
			text := strings.TrimSpace(parsed.Result)
			if text == "" {
				text = "the agent stopped without an answer: " + parsed.Subtype
			}
			step := CompanionStep{Kind: "failed", Text: text, Session: parsed.SessionID}
			if hint := hintFor(text); hint != "" {
				step.Kind, step.Hint, step.HintCode = "signin", hint, signInHintCode
			}
			return []CompanionStep{step}
		}
		return []CompanionStep{{
			Kind:    "done",
			Session: parsed.SessionID,
			Cost:    parsed.Cost,
			Turns:   parsed.Turns,
		}}
	}
	return nil
}

// hintFor recognises a failure the reader can do something about.
func hintFor(text string) string {
	lower := strings.ToLower(text)
	for _, mark := range []string{
		"not logged in", "not authenticated", "authentication", "unauthorized",
		"invalid api key", "please run /login", "claude auth login", "oauth token",
		"credentials", "sign in", "log in",
	} {
		if strings.Contains(lower, mark) {
			return signInHint
		}
	}
	return ""
}

// toolTarget names what a tool call looked at, relative to the repository, so
// the reader shows 'cmd/facet/hook.go' rather than a path down to someone's
// home directory.
func toolTarget(raw json.RawMessage, root string) string {
	if len(raw) == 0 {
		return ""
	}
	var input map[string]any
	if err := json.Unmarshal(raw, &input); err != nil {
		return ""
	}
	for _, key := range []string{"file_path", "path", "pattern", "query", "command"} {
		if value, ok := input[key].(string); ok && value != "" {
			if rel, err := filepath.Rel(root, value); err == nil && !strings.HasPrefix(rel, "..") {
				return filepath.ToSlash(rel)
			}
			return value
		}
	}
	return ""
}

// toolLines is the line range a Read call asked for, as "from-to".
func toolLines(name string, raw json.RawMessage) string {
	if !strings.EqualFold(name, "Read") || len(raw) == 0 {
		return ""
	}
	var input struct {
		Offset *int `json:"offset"`
		Limit  *int `json:"limit"`
	}
	if err := json.Unmarshal(raw, &input); err != nil {
		return ""
	}
	// A Read with only a limit reads from line 1; one with only an offset
	// reads to the end of the file, which the call does not say, so no range.
	if input.Limit == nil || *input.Limit < 1 {
		return ""
	}
	from := 1
	if input.Offset != nil {
		if *input.Offset < 1 {
			return ""
		}
		from = *input.Offset
	}
	return strconv.Itoa(from) + "-" + strconv.Itoa(from+*input.Limit-1)
}

// isReadTool reports whether a tool name is one the companion is allowed to
// run, and therefore one whose use is worth reporting.
func isReadTool(name string) bool {
	for _, allowed := range strings.Split(readOnlyTools, ",") {
		if strings.EqualFold(name, allowed) {
			return true
		}
	}
	// Retrieval is reported like any other read, and the reader draws it
	// differently: it consulted an index, not a file, and saying "read
	// docs/facets/…" of a search would be a claim about a file nobody opened.
	return strings.EqualFold(name, ragToolName)
}
