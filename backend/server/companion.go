package server

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/facet-framework/atlas/backend/agents"
	"github.com/facet-framework/core/registry"
)

type Companion struct {
	// Root is the repository the agent works in.
	Root string

	// sourceRegistry retains the frozen selection through Core's public registry API.
	sourceRegistry *facet.Registry
	// Bin is the Claude Code executable. Empty means "claude" on PATH.
	Bin string
	// Model is passed through when set; empty leaves the choice to Claude Code.
	Model string
	// MaxTurns bounds one answer. Zero uses the default below.
	MaxTurns int

	PluginsDir string

	// readerPrompt says what the reader has open and which mode they chose.
	// Set per question on a copy, like Model, from readerContextPrompt.
	readerPrompt string
}

// CompanionStep is one thing that happened while answering.
type CompanionStep struct {
	// Kind is one of:
	// status    the agent's own phase, before it has anything to show
	// thinking  reasoning, as it is written
	// read      a tool call: which tool, and what it looked at
	// text      the answer, in pieces as they arrive
	// done      the run ended, with the session and what it was worth
	// failed    it ended without an answer, with the reason
	// signin    it cannot run because nobody is signed in
	Kind string `json:"kind"`
	// Tool and Target describe a read: which tool, and what it looked at.
	Tool   string `json:"tool,omitempty"`
	Target string `json:"target,omitempty"`
	// Lines is the line range a Read asked for, "from-to", present only when
	// the call itself carried both offset and limit. It is copied from the
	// call and never derived from the answer's text: a range the model names
	// in prose is its claim, the call's arguments are what was opened.
	Lines string `json:"lines,omitempty"`
	// Text carries prose, reasoning, or the reason a run failed. When the
	// reason is a sentence the host wrote itself, TextCode names it; the
	// agent's own words never carry one.
	Text     string `json:"text,omitempty"`
	TextCode string `json:"textCode,omitempty"`
	// Session identifies the conversation, so a follow-up can continue it.
	Session string `json:"session,omitempty"`
	// Cost is what the agent reports the answer was worth, in dollars. On a
	// subscription that is the API-equivalent of the work rather than a charge:
	// the account is the one already signed in, and what it is billed for is its
	// own business.
	Cost float64 `json:"cost,omitempty"`
	// Tokens counts the reasoning so far, which is the only honest progress
	// indicator during a long think: it is measured, not estimated from a clock.
	Tokens int `json:"tokens,omitempty"`
	// Turns is how many exchanges the answer took.
	Turns int `json:"turns,omitempty"`
	// Model is what actually answered, which is not always what was asked for:
	// a fallback may have stepped in.
	Model string `json:"model,omitempty"`
	// Hint is what to do about a failure, when there is something to do. It
	// is English source text; HintCode names it for a reader that translates.
	Hint     string `json:"hint,omitempty"`
	HintCode string `json:"hintCode,omitempty"`
}

// CompanionAuth is who the agent would answer as.
type CompanionAuth struct {
	LoggedIn bool   `json:"loggedIn"`
	Method   string `json:"authMethod,omitempty"`
	Email    string `json:"email,omitempty"`
	Plan     string `json:"subscriptionType,omitempty"`
	// Available is false when the agent is not installed at all, which is a
	// different problem from being installed and signed out.
	Available bool `json:"available"`
	// Reason says what is wrong, when something is. English source text; a
	// sentence the host writes itself carries ReasonCode beside it, an error
	// passed through from below does not.
	Reason     string `json:"reason,omitempty"`
	ReasonCode string `json:"reasonCode,omitempty"`
	// Hint says what to do about it, with HintCode beside it.
	Hint     string `json:"hint,omitempty"`
	HintCode string `json:"hintCode,omitempty"`
}

// CompanionModel is a model the picker offers.
type CompanionModel struct {
	// ID is what is passed to the agent.
	ID string `json:"id"`
	// Label is what the picker shows.
	Label string `json:"label"`
	// Note says what it is for, in a few words. English source text: the
	// reader translates the built-in models by ID and shows any other note
	// as sent.
	Note string `json:"note,omitempty"`
}

// CompanionModels are the aliases the agent resolves to whatever is current.
var CompanionModels = []CompanionModel{
	{ID: "", Label: "Default", Note: "configured in Claude Code"},
	{ID: "haiku", Label: "Haiku", Note: "fast and economical, for locating information"},
	{ID: "sonnet", Label: "Sonnet", Note: "balanced capability"},
	{ID: "opus", Label: "Opus", Note: "for questions that need wider context"},
}

// readOnlyTools is what the companion may use. Read, Grep and Glob answer
// "where is this" and "what does it say"; nothing here changes a file.
const readOnlyTools = "Read,Grep,Glob"

// ragToolName is the retrieval tool, as Claude Code addresses an MCP tool.
const ragToolName = "mcp__facet__rag_query"

// ragServerName is the MCP server's key in the config below. It is what makes
// the tool name above `mcp__facet__…` rather than anything else.
const ragServerName = "facet"

// blockedTools is what it may not, and this list is the one that does the work.
const blockedTools = "Bash,BashOutput,KillShell,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch,SlashCommand"

// fixedTools is every tool whose state this build decides: the read tools are
// always allowed and the deny list is always denied, and nothing a reader does
// moves either. The retrieval tool follows the project's index and a plugin
// tool follows its grant, so neither is on it; the settings page shows the
// difference as "settled" against "changeable".
func fixedTools() []string {
	return append(strings.Split(readOnlyTools, ","), strings.Split(blockedTools, ",")...)
}

// isolationFlag starts the companion apart from the session configuration
// (the spawn says why this flag and not --safe-mode or --bare). It is a
// constant so the settings page reports the flag the spawn passes, not a
// sentence beside it that could drift.
const isolationFlag = "--setting-sources"

// isolationDrops names what an empty isolationFlag leaves out, in words the
// reader translates: the project's hooks, its plugins, its MCP servers and its
// CLAUDE.md all arrive through settings, so none of them reaches the companion.
var isolationDrops = []string{"hooks", "plugins", "mcp", "instructions"}

// CompanionIsolation is what the settings page states about that isolation.
type CompanionIsolation struct {
	// Flag is the flag as passed, its empty value written out.
	Flag  string   `json:"flag"`
	Drops []string `json:"drops"`
}

func companionIsolation() CompanionIsolation {
	return CompanionIsolation{Flag: isolationFlag + ` ""`, Drops: append([]string(nil), isolationDrops...)}
}

const defaultMaxTurns = 12

// companionProfile names the subagent profile the companion runs as.
const companionProfile = "atlas-companion"

// companionFallbackPrompt is used only if the profile cannot be read.
const companionFallbackPrompt = `You are answering one question inside the Atlas reader of a FACET project.

FACET records live under the registry's records directory as YAML: each one
states a feature's intent, its contract scenarios, how it is verified, and who
owns it. Source files link back to a record with an '@facet: <id>' comment.

Answer from what you actually read. Name the file you took an answer from.
When a record and the code disagree, say so plainly and say which is which.
Keep answers to a few sentences unless asked for more. You cannot change
anything, and should not offer to.`

// signInHint is what to do when nobody is signed in.
const signInHint = "Sign in in a terminal: `claude auth login`. Then ask here again."

// Message codes for the sentences the companion writes itself. They are wire
// format: the reader keeps one dictionary entry per code, and renaming one is a
// migration.
const (
	signInHintCode         = "companion.sign-in"
	installHintCode        = "companion.install"
	authUnknownCode        = "companion.auth-unknown"
	authUnreadableCode     = "companion.auth-unreadable"
	authNobodySignedInCode = "companion.nobody-signed-in"
)

// Available reports whether the companion can run at all.
func (c *Companion) Available() error {
	if c.sourceRegistry != nil && c.sourceRegistry.SourceView != nil {
		cfg, err := c.config()
		if err != nil {
			return err
		}
		fresh, err := cfg.ResolveSourceView(c.sourceRegistry.SourceView.Name)
		if err != nil {
			return err
		}
		for id, frozen := range c.sourceRegistry.SourceView.Sources {
			selected, err := fresh.Source(id)
			if err != nil {
				return err
			}
			if selected.Root != frozen.Root || selected.Revision != frozen.Revision || selected.ContentHash != frozen.ContentHash {
				return fmt.Errorf("source view %q changed since Atlas opened; reload Atlas before asking", c.sourceRegistry.SourceView.Name)
			}
		}
	}
	if err := c.validateSourceView(); err != nil {
		return err
	}
	bin := c.executable()
	if _, err := exec.LookPath(bin); err != nil {
		return fmt.Errorf("%s is not on PATH", bin)
	}
	if !isDir(c.Root) {
		return fmt.Errorf("%s is not a directory", c.Root)
	}
	return nil
}

// Auth reports who the agent would answer as.
func (c *Companion) Auth(ctx context.Context) CompanionAuth {
	if err := c.Available(); err != nil {
		return CompanionAuth{
			Available: false,
			Reason:    err.Error(),
			Hint:      "Install Claude Code, then the companion can read the code: https://claude.com/claude-code",
			HintCode:  installHintCode,
		}
	}

	cmd := exec.CommandContext(ctx, c.executable(), "auth", "status", "--json")
	cmd.Dir = c.Root
	cmd.Env = companionEnv(os.Environ())
	out, err := cmd.Output()
	if err != nil {
		// An agent that cannot say who it is cannot be trusted to answer as
		// anyone, so this counts as signed out rather than as unknown.
		return CompanionAuth{
			Available:  true,
			Reason:     "Claude Code does not say who is signed in.",
			ReasonCode: authUnknownCode,
			Hint:       signInHint,
			HintCode:   signInHintCode,
		}
	}

	var status CompanionAuth
	if err := json.Unmarshal(out, &status); err != nil {
		return CompanionAuth{
			Available: true, Reason: "The sign-in state is unreadable.", ReasonCode: authUnreadableCode,
			Hint: signInHint, HintCode: signInHintCode,
		}
	}
	status.Available = true
	if !status.LoggedIn {
		status.Reason = "Nobody is signed in to Claude Code."
		status.ReasonCode = authNobodySignedInCode
		status.Hint = signInHint
		status.HintCode = signInHintCode
	}
	return status
}

func (c *Companion) executable() string {
	if c.Bin != "" {
		return c.Bin
	}
	if env := os.Getenv("FACET_COMPANION_BIN"); env != "" {
		return env
	}
	return "claude"
}

// @facet: assistance/conversations/model-selection
// @facet-role: primary
// @facet: assistance/conversations/question-answering
// @facet-role: primary
// @facet: assistance/preferences/agent-sandboxing
// @facet-role: primary
// Ask runs one question and reports each step through emit.
func (c *Companion) Ask(ctx context.Context, question, session string, emit func(CompanionStep) bool) error {
	if strings.TrimSpace(question) == "" {
		emit(CompanionStep{Kind: "failed", Text: "no question"})
		return errors.New("no question")
	}
	if session != "" && !sessionIDRe.MatchString(session) {
		emit(CompanionStep{Kind: "failed", Text: "invalid session id"})
		return errors.New("invalid session id")
	}
	// Checked before the run rather than after a failed one: being told what is
	// wrong, and what to type, is worth more than a question that thinks for
	// twenty seconds and then reports an error that reads like a broken tool.

	auth := c.Auth(ctx)
	if !auth.Available {
		emit(CompanionStep{Kind: "failed", Text: auth.Reason, Hint: auth.Hint, HintCode: auth.HintCode})
		return errors.New(auth.Reason)
	}
	if !auth.LoggedIn {
		emit(CompanionStep{Kind: "signin", Text: auth.Reason, TextCode: auth.ReasonCode, Hint: auth.Hint, HintCode: auth.HintCode})
		return errors.New(auth.Reason)
	}

	turns := c.MaxTurns
	if turns <= 0 {
		turns = defaultMaxTurns
	}

	profile, definition := companionAgent()

	args := []string{
		"-p",
		"--output-format", "stream-json",
		"--verbose",
		// --tools states which tools exist at all, where --allowedTools only
		// says which may run unprompted. With the latter alone the agent was
		// observed running git and starting a subagent; with this it does not
		// have the option, and a refusal never has to be explained.
		"--tools", c.tools(),
		"--disallowedTools", blockedTools,

		isolationFlag, "",

		"--strict-mcp-config",
		// The profile this window runs on, passed explicitly because no plugin
		// is loaded to supply it. Same file, different route.
		"--agents", definition,
		"--agent", profile,
		// Reasoning and prose as they are written, so the window can show the
		// work instead of a spinner.
		"--include-partial-messages",
		"--max-turns", fmt.Sprint(turns),
	}

	index := c.sourceContext() + c.recordIndex()
	// What the reader has open goes in the same argument, after the index: it
	// is as current as the index, re-sent with every question, and a resumed
	// session is told the page the reader is on now rather than the one the
	// conversation began on.
	if c.readerPrompt != "" {
		if index != "" {
			index += "\n"
		}
		index += c.readerPrompt
	}
	if index != "" {
		args = append(args, "--append-system-prompt", index)
	}

	// The retrieval server, when the project has an index to retrieve from.
	// Same binary, second mode: 'facet mcp' over stdio, so the window needs
	// nothing installed that the reader did not already install to open it.
	if config := c.ragConfig(); config != "" {
		args = append(args, "--mcp-config", config)
	}
	if model := strings.TrimSpace(c.Model); model != "" {
		args = append(args, "--model", model)
	}
	if session != "" {
		args = append(args, "--resume", session)
	}

	cmd := exec.CommandContext(ctx, c.executable(), args...)
	cmd.Dir = c.Root
	cmd.Env = companionEnv(os.Environ())
	// Claude Code reads the print-mode prompt from standard input when no
	// positional prompt is present. Keeping it out of argv prevents a leading
	// dash from being interpreted as another CLI option.
	cmd.Stdin = strings.NewReader(question)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	// Kept apart from the stream so a warning on stderr cannot be read as an
	// event, and reported only if the run then fails.
	var stderr strings.Builder
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		emit(CompanionStep{Kind: "failed", Text: err.Error()})
		return err
	}

	scanner := bufio.NewScanner(stdout)
	// One event is a line, and a line holding a large tool result is ordinary
	// rather than exceptional, so the default 64 KiB limit would end the stream
	// mid-answer.
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)

	alive := true
	for scanner.Scan() {
		if !alive {
			break
		}
		for _, step := range decodeStreamLine(scanner.Bytes(), c.Root) {
			if !emit(step) {
				alive = false
				break
			}
			// One question, one ending. Anything that reports a result of its
			// own after this — and a subagent does — would arrive as a second
			// answer to a question that was already answered.
			if step.Kind == "done" || step.Kind == "failed" {
				alive = false
				break
			}
		}
	}

	waitErr := cmd.Wait()
	if waitErr != nil && alive {
		text := strings.TrimSpace(stderr.String())
		if text == "" {
			text = waitErr.Error()
		}
		emit(CompanionStep{Kind: "failed", Text: text})
	}
	return waitErr
}

// companionAgent renders the profile as Claude Code's --agents payload, and
// returns the name to select it by.
func companionAgent() (string, string) {
	profile, err := agents.Load(companionProfile)
	if err != nil || profile.Prompt == "" {
		profile.Prompt = companionFallbackPrompt
	}
	name := profile.Name
	if name == "" {
		name = companionProfile
	}

	definition := map[string]any{
		"description": profile.Description,
		"prompt":      profile.Prompt,
		"tools":       strings.Split(readOnlyTools, ","),
	}
	// The profile's model is deliberately not passed: the reader has a model
	// picker, and a profile that overrode it would make that picker a lie.
	payload, err := json.Marshal(map[string]any{name: definition})
	if err != nil {
		return name, "{}"
	}
	return name, string(payload)
}

// recordIndex is every record in the project, one line each, handed over so the
// agent does not open the question with a search.
func (c *Companion) recordIndex() string {
	cfg, err := c.config()
	var regs []facet.Registry
	if cfg != nil {
		regs = cfg.All()
	}
	if err != nil || len(regs) == 0 {
		return ""
	}
	return facet.RecordIndex(regs, facet.IndexOptions{Summaries: true})
}

// hasRAGIndex reports whether this project has an index to retrieve from.
func (c *Companion) hasRAGIndex() bool {
	cfg, err := c.config()
	if err != nil {
		return false
	}
	regs := cfg.All()
	if len(regs) == 0 {
		return false
	}
	info, err := os.Stat(cfg.IndexPath(regs[0]))
	return err == nil && !info.IsDir()
}

// tools is the permission list, widened by one when retrieval is available.
func (c *Companion) tools() string {
	list := readOnlyTools
	if c.hasRAGIndex() {
		list += "," + ragToolName
	}

	for _, t := range c.agentPluginTools() {
		list += "," + facet.AgentToolRef(ragServerName, t.Plugin, t.Tool)
	}
	return list
}

// @facet: customization/contributions/plugin-agent-tools
// @facet-role: primary
// agentPluginTools lists what the reader granted the agent, or nothing.
func (c *Companion) agentPluginTools() []facet.AgentTool {
	if c.PluginsDir == "" {
		return nil
	}
	return facet.NewPluginBroker(c.PluginsDir).AgentTools()
}

// needsMCPServer says whether this question has anything for `facet mcp` to
// serve.
func (c *Companion) needsMCPServer() bool {
	return c.hasRAGIndex() || len(c.agentPluginTools()) > 0
}

// ragConfig renders the MCP server that serves rag_query, or "" when there is
// no index and therefore nothing to serve.
func (c *Companion) ragConfig() string {
	if !c.needsMCPServer() {
		return ""
	}
	self, err := os.Executable()
	if err != nil || self == "" {
		return ""
	}
	payload, err := json.Marshal(map[string]any{
		"mcpServers": map[string]any{
			ragServerName: map[string]any{
				"type":    "stdio",
				"command": self,
				"args":    c.mcpArgs(),
			},
		},
	})
	if err != nil {
		return ""
	}
	return string(payload)
}

// sessionMarkers name the environment a running Claude Code session leaves
// behind for its children. The account is not among them.
var sessionMarkers = map[string]bool{
	"CLAUDECODE":                 true,
	"CLAUDE_CODE_SESSION_ID":     true,
	"CLAUDE_CODE_CHILD_SESSION":  true,
	"CLAUDE_CODE_ENTRYPOINT":     true,
	"CLAUDE_CODE_AGENT":          true,
	"CLAUDE_PID":                 true,
	"CLAUDE_EFFORT":              true,
	"CLAUDE_JOB_DIR":             true,
	"CLAUDE_CODE_SSE_PORT":       true,
	"CLAUDE_CODE_ACTION":         true,
	"CLAUDE_CODE_MAX_OUTPUT_TOK": true,
}

// companionEnv hands the agent the environment minus the marks of a session
// that may be running this server.
func companionEnv(env []string) []string {
	out := make([]string, 0, len(env))
	for _, entry := range env {
		name, _, ok := strings.Cut(entry, "=")
		if ok && sessionMarkers[name] {
			continue
		}
		out = append(out, entry)
	}
	return out
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func (c *Companion) config() (*facet.Config, error) {
	if err := c.validateSourceView(); err != nil {
		return nil, err
	}
	if c.sourceRegistry != nil && c.sourceRegistry.SourceView != nil {
		return facet.LoadConfigWithResolvedSourceView(c.Root, c.sourceRegistry.SourceView)
	}
	return facet.LoadConfig(c.Root)
}
func (c *Companion) mcpArgs() []string {
	args := []string{"mcp", "--root", c.Root}
	if c.sourceRegistry != nil && c.sourceRegistry.SourceView != nil {
		args = append(args, "--source-view", c.sourceRegistry.SourceView.Name)
	}
	return args
}
func (c *Companion) sourceContext() string {
	if c.sourceRegistry == nil || c.sourceRegistry.SourceView == nil {
		return ""
	}
	var out strings.Builder
	fmt.Fprintf(&out, "Implementation evidence uses source view %q. Registry files remain under %s. Read implementation only from these selected repository checkouts; do not infer it from another version or from the registry root.\n", c.sourceRegistry.SourceView.Name, c.Root)
	for _, source := range c.sourceRegistry.SourceView.Ordered() {
		fmt.Fprintf(&out, "Repository %s: checkout %s, revision %s, dirty %t, content %s\n", source.Repository, source.Root, source.Revision, source.Dirty, source.ContentHash)
	}
	return out.String()
}

// validateSourceView preserves the no-selection behavior without naming Core's internal type.
func (c *Companion) validateSourceView() error {
	if c.sourceRegistry == nil {
		return nil
	}
	return c.sourceRegistry.SourceView.Validate()
}
