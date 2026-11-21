// The fixtures below stand in for Claude Code, so this file documents the
// stream shape rather than implementing a feature: @facet-ignore-file

package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/facet-framework/core/registry"
)

// fakeClaude writes an executable that prints the given stream-json lines.
func fakeClaude(t *testing.T, lines ...string) string {
	t.Helper()
	return fakeClaudeAuthed(t, `{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}`, lines...)
}

// fakeClaudeAuthed also answers 'auth status --json', which the companion asks
// before every run.
func fakeClaudeAuthed(t *testing.T, auth string, lines ...string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the fake agent is a shell script")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "claude")
	script := "#!/bin/sh\nif [ \"$1\" = auth ]; then\n  echo '" + auth + "'\n  exit 0\nfi\ncat <<'STREAM'\n" +
		strings.Join(lines, "\n") + "\nSTREAM\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func collect(t *testing.T, bin, question string) []CompanionStep {
	t.Helper()
	c := &Companion{Root: t.TempDir(), Bin: bin}
	var steps []CompanionStep
	_ = c.Ask(context.Background(), question, "", func(step CompanionStep) bool {
		steps = append(steps, step)
		return true
	})
	return steps
}

// The three things a reader shows: what was read, what was said, and that it
// finished, with the session that lets the next question continue this one.
func TestAskReportsReadsThenTextThenDone(t *testing.T) {
	bin := fakeClaude(t,
		`{"type":"system","subtype":"init"}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"looksLikeCommit"}}]}}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"It is in cmd/facet/hook.go."}}}`,
		`{"type":"result","subtype":"success","session_id":"abc123","total_cost_usd":0.02}`,
	)

	steps := collect(t, bin, "where is looksLikeCommit")

	if len(steps) != 3 {
		t.Fatalf("want three steps, got %d: %+v", len(steps), steps)
	}
	if steps[0].Kind != "read" || steps[0].Tool != "Grep" || steps[0].Target != "looksLikeCommit" {
		t.Errorf("first step = %+v, want the grep", steps[0])
	}
	if steps[1].Kind != "text" || !strings.Contains(steps[1].Text, "hook.go") {
		t.Errorf("second step = %+v, want the answer", steps[1])
	}
	if steps[2].Kind != "done" || steps[2].Session != "abc123" || steps[2].Cost != 0.02 {
		t.Errorf("third step = %+v, want the session and the cost", steps[2])
	}
}

// A path is shown relative to the repository. An answer that cites
// an absolute checkout path says where the file is on one machine, which is not
// what a reader needs to know.
func TestReadTargetsAreRelativeToTheRepository(t *testing.T) {
	root := t.TempDir()
	bin := fakeClaude(t,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"`+
			filepath.Join(root, "internal", "ui", "server.go")+`"}}]}}`,
		`{"type":"result","subtype":"success","session_id":"s"}`,
	)

	c := &Companion{Root: root, Bin: bin}
	var steps []CompanionStep
	_ = c.Ask(context.Background(), "read it", "", func(s CompanionStep) bool {
		steps = append(steps, s)
		return true
	})

	if len(steps) == 0 || steps[0].Target != "internal/ui/server.go" {
		t.Errorf("want a repository-relative target, got %+v", steps)
	}
}

// A run that ends without an answer says so. Silence would be read as an empty
// answer, which is a different and much worse claim.
func TestAskReportsAFailedRun(t *testing.T) {
	bin := fakeClaude(t,
		`{"type":"result","subtype":"error_max_turns","is_error":true,"result":"ran out of turns"}`,
	)

	steps := collect(t, bin, "something hard")

	if len(steps) != 1 || steps[0].Kind != "failed" || !strings.Contains(steps[0].Text, "turns") {
		t.Errorf("want one failed step naming the reason, got %+v", steps)
	}
}

// A missing agent is the ordinary case on a machine that has not installed it,
// so it has to be a sentence rather than a crash.
func TestAskWithoutTheAgentSaysSo(t *testing.T) {
	c := &Companion{Root: t.TempDir(), Bin: "definitely-not-installed-here"}
	var steps []CompanionStep
	err := c.Ask(context.Background(), "anything", "", func(s CompanionStep) bool {
		steps = append(steps, s)
		return true
	})

	if err == nil {
		t.Error("want an error")
	}
	if len(steps) != 1 || steps[0].Kind != "failed" || !strings.Contains(steps[0].Text, "PATH") {
		t.Errorf("want one failed step about PATH, got %+v", steps)
	}
}

// Lines that carry no news produce no steps, so the reader is not asked to
// render an empty bubble for every heartbeat the agent emits.
func TestQuietLinesProduceNothing(t *testing.T) {
	for _, line := range []string{
		`{"type":"system","subtype":"init"}`,
		`{"type":"rate_limit_event"}`,
		`{"type":"user","message":{"content":[]}}`,
		`{"type":"assistant","message":{"content":[{"type":"text","text":"   "}]}}`,
		`not json at all`,
	} {
		if steps := decodeStreamLine([]byte(line), "/repo"); len(steps) != 0 {
			t.Errorf("%s produced %+v, want nothing", line, steps)
		}
	}
}

// An empty question never starts a process. Asking an agent to answer nothing
// costs the same as asking it something.
func TestAskRefusesAnEmptyQuestion(t *testing.T) {
	c := &Companion{Root: t.TempDir(), Bin: "claude"}
	var steps []CompanionStep
	if err := c.Ask(context.Background(), "   ", "", func(s CompanionStep) bool {
		steps = append(steps, s)
		return true
	}); err == nil {
		t.Error("want an error for an empty question")
	}
}

func TestTheAgentIsDeniedEverythingThatCouldChangeTheRepository(t *testing.T) {
	for _, tool := range []string{"Bash", "Write", "Edit", "NotebookEdit", "Task"} {
		if !strings.Contains(blockedTools, tool) {
			t.Errorf("%s is not blocked, so the companion could use it", tool)
		}
	}
	for _, tool := range []string{"Read", "Grep", "Glob"} {
		if !strings.Contains(readOnlyTools, tool) {
			t.Errorf("%s should be allowed", tool)
		}
	}
}

func TestTheToolListCannotBeWidenedFromOutsideThisPackage(t *testing.T) {
	args := spawnArgs(t, t.TempDir())

	if got := valueAfter(args, "--tools"); got != readOnlyTools {
		t.Errorf("--tools = %q, want %q: the read tools are the whole list", got, readOnlyTools)
	}
	if got := valueAfter(args, "--disallowedTools"); got != blockedTools {
		t.Errorf("--disallowedTools = %q, want %q", got, blockedTools)
	}
	// The exported surface is what a browser could reach through the server.
	// A bool or a string among these fields is a switch waiting to be wired,
	// so the list is pinned: adding one is a decision, not an oversight.
	fields := reflect.VisibleFields(reflect.TypeOf(Companion{}))
	var names []string
	for _, f := range fields {
		if f.IsExported() {
			names = append(names, f.Name)
		}
	}

	want := "Root,Bin,Model,MaxTurns,PluginsDir"
	if strings.Join(names, ",") != want {
		t.Errorf("Companion exports %s, want %s: a new field is a new way for a "+
			"browser to alter the host-controlled tool list", strings.Join(names, ","), want)
	}
}

// A subagent reports a result of its own, which would otherwise arrive as a
// second answer to a question that was already answered.
func TestNothingIsReportedAfterTheAnswerIsDone(t *testing.T) {
	bin := fakeClaude(t,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Here."}}}`,
		`{"type":"result","subtype":"success","session_id":"first","total_cost_usd":0.01}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"And more."}}}`,
		`{"type":"result","subtype":"success","session_id":"second","total_cost_usd":0.9}`,
	)

	steps := collect(t, bin, "one question")

	var dones int
	for _, step := range steps {
		if step.Kind == "done" {
			dones++
			if step.Session != "first" {
				t.Errorf("done carries session %q, want the first", step.Session)
			}
		}
	}
	if dones != 1 {
		t.Errorf("want exactly one done, got %d in %+v", dones, steps)
	}
}

// A blocked tool still appears in the stream: the agent asks for it and the
// permission layer refuses afterwards. Reporting the attempt would tell the
// reader that a file was consulted when nothing was.
func TestABlockedToolIsNotReportedAsSomethingRead(t *testing.T) {
	bin := fakeClaude(t,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"git status"}}]}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"README.md"}}]}}`,
		`{"type":"result","subtype":"success","session_id":"s"}`,
	)

	steps := collect(t, bin, "run git status")

	for _, step := range steps {
		if step.Kind == "read" && step.Tool != "Read" {
			t.Errorf("reported %q as read, want only tools that can run", step.Tool)
		}
	}
}

// The companion signs in as whoever is signed in on this machine, so the
// account has to survive; the identity of a session that happens to be running
// this server must not.
func TestTheAgentInheritsTheAccountButNotTheSession(t *testing.T) {
	env := companionEnv([]string{
		"ANTHROPIC_BASE_URL=https://example.invalid",
		"ANTHROPIC_API_KEY=secret",
		"PATH=/usr/bin",
		"CLAUDECODE=1",
		"CLAUDE_CODE_SESSION_ID=abc",
		"CLAUDE_CODE_ENTRYPOINT=cli",
	})

	joined := strings.Join(env, "\n")
	for _, keep := range []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "PATH"} {
		if !strings.Contains(joined, keep) {
			t.Errorf("%s was dropped, and the agent needs it to sign in or to run", keep)
		}
	}
	for _, drop := range []string{"CLAUDECODE=", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_ENTRYPOINT"} {
		if strings.Contains(joined, drop) {
			t.Errorf("%s survived, so the agent inherits another session's identity", drop)
		}
	}
}

// Nobody signed in is the one failure with a fixed answer, so it is reported
// before the question runs and carries the command that fixes it. A reader is a
// browser tab; the remedy is a terminal, and it has to be spelled out.
func TestSignedOutSaysHowToSignIn(t *testing.T) {
	bin := fakeClaudeAuthed(t, `{"loggedIn":false}`,
		`{"type":"result","subtype":"success","session_id":"never"}`,
	)

	steps := collect(t, bin, "anything")

	if len(steps) != 1 {
		t.Fatalf("want one step, got %+v", steps)
	}
	if steps[0].Kind != "signin" {
		t.Errorf("kind = %q, want signin", steps[0].Kind)
	}
	if !strings.Contains(steps[0].Hint, "claude auth login") {
		t.Errorf("hint = %q, want the sign-in command", steps[0].Hint)
	}
}

// A host message follows the reader's language: the sign-in sentences travel
// with stable codes beside their English text, on the state route a reader
// asks before the first question and on the step a refused question gets.
// Both are read off the wire, not the Go value.
func TestTheSignInSentencesTravelWithCodes(t *testing.T) {
	bin := fakeClaudeAuthed(t, `{"loggedIn":false}`,
		`{"type":"result","subtype":"success","session_id":"never"}`,
	)
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	srv := httptest.NewServer((&Server{
		Registry:  reg,
		Assets:    fstest.MapFS{},
		Companion: &Companion{Root: reg.Root, Bin: bin},
	}).Handler())
	defer srv.Close()

	res, err := readerGET(srv.URL + CompanionStatePath)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var state struct {
		Auth map[string]any `json:"auth"`
	}
	if err := json.NewDecoder(res.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	if state.Auth["reasonCode"] != "companion.nobody-signed-in" {
		t.Errorf("auth.reasonCode = %v", state.Auth["reasonCode"])
	}
	if state.Auth["reason"] != "Nobody is signed in to Claude Code." {
		t.Errorf("auth.reason = %v, want the English source text", state.Auth["reason"])
	}
	if state.Auth["hintCode"] != "companion.sign-in" {
		t.Errorf("auth.hintCode = %v", state.Auth["hintCode"])
	}

	stream, err := companionGET(srv.URL + CompanionPath + "?q=anything")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	if stream.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", stream.StatusCode)
	}
	body, err := io.ReadAll(stream.Body)
	if err != nil {
		t.Fatal(err)
	}
	got := events(t, string(body))
	if len(got) != 1 || got[0][0] != "signin" {
		t.Fatalf("events = %v, want exactly one signin event", got)
	}
	var step map[string]any
	if err := json.Unmarshal([]byte(got[0][1]), &step); err != nil {
		t.Fatalf("signin event data %q: %v", got[0][1], err)
	}
	if step["hintCode"] != "companion.sign-in" || step["textCode"] != "companion.nobody-signed-in" {
		t.Errorf("signin event data = %s, want hintCode and textCode", got[0][1])
	}
	if step["text"] != "Nobody is signed in to Claude Code." {
		t.Errorf("signin event text = %v, want the English source text", step["text"])
	}
}

// A failure the agent reports in its own words gets the sign-in hint by code,
// and its own words keep no code: they are not the host's sentence.
func TestASignInFailureFromTheAgentCarriesTheHintCodeOnly(t *testing.T) {
	bin := fakeClaude(t,
		`{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Invalid API key · Please run /login"}`,
	)
	steps := collect(t, bin, "anything")
	last := steps[len(steps)-1]
	if last.Kind != "signin" || last.HintCode != "companion.sign-in" {
		t.Fatalf("last step = %+v, want a signin step with hintCode companion.sign-in", last)
	}
	if last.TextCode != "" {
		t.Fatalf("the agent's own words carried a code: %q", last.TextCode)
	}
}

// Reasoning and prose arrive while they are written, so the window can show the
// work rather than a spinner.
func TestThinkingAndTextArriveAsTheyAreWritten(t *testing.T) {
	bin := fakeClaude(t,
		`{"type":"system","subtype":"status","status":"requesting"}`,
		`{"type":"system","subtype":"thinking_tokens","estimated_tokens":42}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Search first."}}}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"The answer"}}}`,
		`{"type":"result","subtype":"success","session_id":"s","num_turns":2}`,
	)

	steps := collect(t, bin, "question")

	var kinds []string
	for _, step := range steps {
		kinds = append(kinds, step.Kind)
	}
	want := []string{"status", "status", "thinking", "text", "done"}
	if strings.Join(kinds, ",") != strings.Join(want, ",") {
		t.Fatalf("kinds = %v, want %v", kinds, want)
	}
	if steps[1].Tokens != 42 {
		t.Errorf("token count = %d, want the measured 42", steps[1].Tokens)
	}
	if steps[2].Text != "Search first." {
		t.Errorf("thinking = %q", steps[2].Text)
	}
	if steps[4].Turns != 2 {
		t.Errorf("turns = %d, want 2", steps[4].Turns)
	}
}

// The finished assistant message repeats prose that already arrived as deltas,
// so it is read only for the tool calls. Otherwise every answer would be shown
// twice.
func TestFinishedMessagesDoNotRepeatTheProse(t *testing.T) {
	steps := decodeStreamLine([]byte(
		`{"type":"assistant","message":{"content":[{"type":"text","text":"already seen"},{"type":"tool_use","name":"Read","input":{"file_path":"a.go"}}]}}`,
	), "/repo")

	if len(steps) != 1 || steps[0].Kind != "read" {
		t.Errorf("want only the tool call, got %+v", steps)
	}
}

// recordingClaude writes an executable that saves its arguments and then
// answers, so what the window actually spawns can be asserted on rather than
// assumed.
func recordingClaude(t *testing.T) (bin, argv string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the fake agent is a shell script")
	}
	dir := t.TempDir()
	bin = filepath.Join(dir, "claude")
	argv = filepath.Join(dir, "argv")
	script := "#!/bin/sh\n" +
		"if [ \"$1\" = auth ]; then echo '{\"loggedIn\":true}'; exit 0; fi\n" +
		"for a in \"$@\"; do printf '%s\\000' \"$a\" >> " + argv + "; done\n" +
		"echo '{\"type\":\"result\",\"subtype\":\"success\",\"session_id\":\"s\"}'\n"
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return bin, argv
}

func recordedArgs(t *testing.T, question, session string) []string {
	t.Helper()
	bin, argv := recordingClaude(t)
	c := &Companion{Root: t.TempDir(), Bin: bin}
	_ = c.Ask(context.Background(), question, session, func(CompanionStep) bool { return true })
	data, err := os.ReadFile(argv)
	if err != nil {
		t.Fatalf("the agent was never spawned: %v", err)
	}
	return strings.Split(strings.TrimSuffix(string(data), "\x00"), "\x00")
}

func spawnArgs(t *testing.T, root string) []string {
	t.Helper()
	bin, argv := recordingClaude(t)
	c := &Companion{Root: root, Bin: bin}
	_ = c.Ask(context.Background(), "where is that", "", func(CompanionStep) bool { return true })
	data, err := os.ReadFile(argv)
	if err != nil {
		t.Fatalf("the agent was never spawned: %v", err)
	}
	// NUL-separated: an argument can itself be many lines — the record index is —
	// and splitting on newlines would report each of its lines as its own argument.
	return strings.Split(strings.TrimSuffix(string(data), "\x00"), "\x00")
}

func TestQuestionCannotBecomeAClaudeOption(t *testing.T) {
	for _, question := range []string{
		`--settings={"permissions":{"allow":["Bash(*)"]}}`,
		"--permission-mode=bypassPermissions",
	} {
		args := recordedArgs(t, question, "")
		if contains(args, question) {
			t.Errorf("question %q appeared in argv: %v", question, args)
		}
	}
}

func TestSessionMustBeAUUIDBeforeClaudeIsStarted(t *testing.T) {
	bin, argv := recordingClaude(t)
	c := &Companion{Root: t.TempDir(), Bin: bin}
	var steps []CompanionStep
	err := c.Ask(context.Background(), "question", "--dangerously-skip-permissions", func(step CompanionStep) bool {
		steps = append(steps, step)
		return true
	})
	if err == nil || len(steps) != 1 || steps[0].Text != "invalid session id" {
		t.Fatalf("invalid session result = %v, %+v", err, steps)
	}
	if _, err := os.Stat(argv); !os.IsNotExist(err) {
		t.Fatalf("invalid session started Claude and recorded argv at %s", argv)
	}

	const valid = "123e4567-e89b-12d3-a456-426614174000"
	args := recordedArgs(t, "question", valid)
	if got := valueAfter(args, "--resume"); got != valid {
		t.Fatalf("--resume = %q, want %q in %v", got, valid, args)
	}
	if contains(args, "--dangerously-skip-permissions") {
		t.Fatalf("rejected session appeared as an option in argv: %v", args)
	}
}

// The profile is passed on the command line because no plugin is loaded to
// supply it. Both halves are needed: --agents defines it, --agent selects it,
// and a run with only the first uses the default profile without complaining.
func TestTheCompanionRunsAsItsOwnProfile(t *testing.T) {
	args := spawnArgs(t, t.TempDir())

	definition := valueAfter(args, "--agents")
	if definition == "" {
		t.Fatalf("no --agents in %v", args)
	}
	var agents map[string]struct {
		Description string   `json:"description"`
		Prompt      string   `json:"prompt"`
		Tools       []string `json:"tools"`
	}
	if err := json.Unmarshal([]byte(definition), &agents); err != nil {
		t.Fatalf("--agents is not JSON Claude Code can read: %v", err)
	}
	profile, ok := agents["atlas-companion"]
	if !ok {
		t.Fatalf("--agents defines %v, want atlas-companion", agents)
	}
	if got := valueAfter(args, "--agent"); got != "atlas-companion" {
		t.Errorf("--agent = %q; a defined profile that is not selected is not used", got)
	}
	if !strings.Contains(profile.Prompt, "FACET") {
		t.Errorf("the profile carries no prompt: %q", profile.Prompt)
	}
	// A profile promising a tool the process denies produces refusals nobody
	// can explain, so the two statements are pinned to each other.
	if strings.Join(profile.Tools, ",") != readOnlyTools {
		t.Errorf("profile tools %v disagree with %q", profile.Tools, readOnlyTools)
	}
}

// The settings page states the isolation from the host's answer. That answer
// has to name the flag the spawn actually passes, with the value it passes, or
// the page would describe a sandbox the process does not run in.
func TestTheStateNamesTheIsolationTheSpawnPasses(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	srv := httptest.NewServer((&Server{
		Registry:  reg,
		Assets:    fstest.MapFS{},
		Companion: &Companion{Root: reg.Root, Bin: fakeClaude(t)},
	}).Handler())
	defer srv.Close()

	res, err := readerGET(srv.URL + CompanionStatePath)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var state struct {
		Isolation struct {
			Flag  string   `json:"flag"`
			Drops []string `json:"drops"`
		} `json:"isolation"`
	}
	if err := json.NewDecoder(res.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	fields := strings.Fields(state.Isolation.Flag)
	if len(fields) != 2 || fields[1] != `""` {
		t.Fatalf("isolation flag = %q, want the flag and its empty value", state.Isolation.Flag)
	}
	args := spawnArgs(t, t.TempDir())
	i := -1
	for j, arg := range args {
		if arg == fields[0] {
			i = j
		}
	}
	if i < 0 || i+1 >= len(args) || args[i+1] != "" {
		t.Errorf("the state names %q, but the spawn passes %v", state.Isolation.Flag, args)
	}
	want := []string{"hooks", "plugins", "mcp", "instructions"}
	if strings.Join(state.Isolation.Drops, ",") != strings.Join(want, ",") {
		t.Errorf("isolation drops = %v, want %v", state.Isolation.Drops, want)
	}
}

func TestTheCompanionLoadsNoneOfTheRepositorysConfiguration(t *testing.T) {
	args := spawnArgs(t, t.TempDir())

	var sources int
	for i, arg := range args {
		if arg != "--setting-sources" {
			continue
		}
		sources++
		if i+1 >= len(args) {
			t.Fatalf("--setting-sources is the last argument and carries no value: %v", args)
		}
		if args[i+1] != "" {
			t.Errorf("--setting-sources = %q, want empty: hooks, plugins and MCP servers all come from settings", args[i+1])
		}
	}
	if sources != 1 {
		t.Errorf("--setting-sources appears %d times in %v, want exactly once: the last one wins", sources, args)
	}
	if !contains(args, "--strict-mcp-config") {
		t.Error("a read-only window must not pick up MCP servers from a stray .mcp.json")
	}
	// --bare would isolate too, and takes the sign-in with it. The account here
	// is a subscription rather than a key, so it must never appear.
	if contains(args, "--bare") {
		t.Error("--bare would break the sign-in this window depends on")
	}
	// A flag that would hand the run the repository's configuration by another
	// name. --safe-mode is not among them: it isolates, and it was dropped only
	// because it also refuses the profile this window passes on the command
	// line.
	for _, flag := range []string{
		"--settings", "--setting-sources=project", "--add-dir",
		"--plugin", "--plugins", "--mcp-config-add", "--dangerously-skip-permissions",
	} {
		if contains(args, flag) {
			t.Errorf("%s would load configuration this window deliberately leaves out", flag)
		}
	}
}

func TestNothingOutsideTheHostCanLoadTheRepositorysConfiguration(t *testing.T) {
	args := spawnArgs(t, t.TempDir())

	if got := valueAfter(args, "--setting-sources"); got != "" {
		t.Errorf("--setting-sources = %q, want empty", got)
	}

	fields := reflect.VisibleFields(reflect.TypeOf(Companion{}))
	var names []string
	for _, f := range fields {
		if f.IsExported() {
			names = append(names, f.Name)
		}
	}
	want := "Root,Bin,Model,MaxTurns,PluginsDir"
	if strings.Join(names, ",") != want {
		t.Errorf("Companion exports %s, want %s: a new field is a new way for a browser "+
			"to alter the host-controlled session isolation", strings.Join(names, ","), want)
	}
}

// installAgentPlugin writes a plugin whose tool is offered to the agent, and
// returns the directory to point a Companion at.
func installAgentPlugin(t *testing.T, grantAI bool) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "sample"), 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"sample","tools":["fixture.pull"],
	  "ai_tools":[{"tool":"fixture.pull","description":"Pull a page.",
	  "input":{"type":"object"}}]}`
	if err := os.WriteFile(filepath.Join(dir, "sample", "plugin.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	grant := `{"tools":["fixture.pull"]}`
	if grantAI {
		grant = `{"tools":["fixture.pull"],"ai_tools":["fixture.pull"]}`
	}
	if err := os.WriteFile(filepath.Join(dir, "sample", "grants.json"), []byte(grant), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// spawnArgsWithPlugins is spawnArgs for a reader that has plugins installed.
func spawnArgsWithPlugins(t *testing.T, root, plugins string) []string {
	t.Helper()
	bin, argv := recordingClaude(t)
	c := &Companion{Root: root, Bin: bin, PluginsDir: plugins}
	_ = c.Ask(context.Background(), "where is that", "", func(CompanionStep) bool { return true })
	data, err := os.ReadFile(argv)
	if err != nil {
		t.Fatalf("the agent was never spawned: %v", err)
	}
	return strings.Split(strings.TrimSuffix(string(data), "\x00"), "\x00")
}

func TestAGrantedAgentToolReachesTheToolList(t *testing.T) {
	args := spawnArgsWithPlugins(t, t.TempDir(), installAgentPlugin(t, true))

	want := facet.AgentToolRef(ragServerName, "sample", "fixture.pull")
	got := valueAfter(args, "--tools")
	if !strings.Contains(got, want) {
		t.Errorf("--tools = %q, want it to carry %q", got, want)
	}
	// And the read tools are still there: a plugin tool must be an addition,
	// never a replacement.
	if !strings.Contains(got, readOnlyTools) {
		t.Errorf("--tools = %q, want it to still carry %q", got, readOnlyTools)
	}
}

// The agent grant is a separate question from the plugin's own grant.
func TestAToolGrantedOnlyToThePluginDoesNotReachTheAgent(t *testing.T) {
	args := spawnArgsWithPlugins(t, t.TempDir(), installAgentPlugin(t, false))

	unwanted := facet.AgentToolName("sample", "fixture.pull")
	if got := valueAfter(args, "--tools"); strings.Contains(got, unwanted) {
		t.Errorf("--tools = %q, must not carry %q: granting the plugin's surface "+
			"a tool is not granting it to a model that reads pages other people wrote", got, unwanted)
	}
}

func TestWithoutPluginsTheToolListIsUnchanged(t *testing.T) {
	args := spawnArgs(t, t.TempDir())

	if got := valueAfter(args, "--tools"); strings.Contains(got, "plugin_") {
		t.Errorf("--tools = %q, want no plugin tool for a reader that has none", got)
	}
}

// A listed plugin tool has a server behind it, even without a RAG index.
func TestAPluginToolIsOfferedWithAServerBehindIt(t *testing.T) {
	// t.TempDir() has no RAG index, which is the point.
	args := spawnArgsWithPlugins(t, t.TempDir(), installAgentPlugin(t, true))

	if !contains(args, "--mcp-config") {
		t.Fatalf("--tools carries a plugin tool and no --mcp-config was passed: %v",
			valueAfter(args, "--tools"))
	}
	config := valueAfter(args, "--mcp-config")
	if !strings.Contains(config, ragServerName) {
		t.Errorf("--mcp-config = %q, want the %q server the tool name refers to", config, ragServerName)
	}
}

// And a reader with neither an index nor a plugin tool still gets no server.
func TestWithoutIndexOrPluginToolsNoServerIsPassed(t *testing.T) {
	args := spawnArgs(t, t.TempDir())

	if contains(args, "--mcp-config") {
		t.Errorf("a reader with no index and no plugin tools was given %q",
			valueAfter(args, "--mcp-config"))
	}
}

// The companion this package builds for itself carries no plugin directory.
func TestTheFallbackCompanionCarriesNoPluginDirectory(t *testing.T) {
	plugins := installAgentPlugin(t, true)
	srv := &Server{Registry: facet.Registry{Root: t.TempDir()}}

	got := srv.companion()

	if got.PluginsDir != "" {
		t.Fatalf("the fallback companion carries PluginsDir %q, want empty", got.PluginsDir)
	}
	// And the directory that WOULD have widened the list exists, so this is
	// not passing because there was nothing to find.
	if tools := facet.NewPluginBroker(plugins).AgentTools(); len(tools) != 1 {
		t.Fatalf("the fixture offers %d agent tool(s), want 1", len(tools))
	}
}

// The index goes in on every question, including a resumed one, because every
// question is a fresh process. That is what makes "at the start, and after
// every compaction" true here without a hook to fire it.
func TestEveryQuestionCarriesTheRecordIndex(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "docs/facets/features/billing/invoice"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "docs/facets/features/billing/invoice/list.yaml"),
		[]byte("schema_version: \"0.1\"\nid: billing/invoice/list\nlifecycle: active\nintent:\n  summary: |\n    Lists invoices.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	args := spawnArgs(t, root)

	var index string
	for i, arg := range args {
		if arg == "--append-system-prompt" && i+1 < len(args) && strings.Contains(args[i+1], "record index") {
			index = args[i+1]
		}
	}
	if index == "" {
		t.Fatalf("no record index in %v", args)
	}
	if !strings.Contains(index, "billing/invoice/list") {
		t.Errorf("the index does not name the project's only record:\n%s", index)
	}
}

// A project with no records passes no index, rather than an index announcing
// that there is nothing to index.
func TestAProjectWithoutRecordsPassesNoIndex(t *testing.T) {
	args := spawnArgs(t, t.TempDir())

	for _, arg := range args {
		if strings.Contains(arg, "FACET record index") {
			t.Errorf("an empty project was given an index:\n%s", arg)
		}
	}
}

func valueAfter(args []string, flag string) string {
	for i, arg := range args {
		if arg == flag && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

func contains(args []string, flag string) bool {
	for _, arg := range args {
		if arg == flag {
			return true
		}
	}
	return false
}

// The reader's "nothing written" is read from this response, so the response
// has to carry the deny list the agent is actually started with. A fixed list
// in this test would only check the test against itself: the list is compared
// with what the spawn passes to --disallowedTools.
func TestCompanionStateDeliversTheDenyListTheAgentRunsWith(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	srv := httptest.NewServer((&Server{
		Registry:  reg,
		Assets:    fstest.MapFS{},
		Companion: &Companion{Root: reg.Root, Bin: fakeClaude(t)},
	}).Handler())
	defer srv.Close()

	res, err := readerGET(srv.URL + CompanionStatePath)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var state struct {
		BlockedTools []string `json:"blockedTools"`
		AllowedTools []string `json:"allowedTools"`
	}
	if err := json.NewDecoder(res.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}

	var passed string
	args := spawnArgs(t, t.TempDir())
	if got, want := strings.Join(state.AllowedTools, ","), valueAfter(args, "--tools"); got != want {
		t.Errorf("state delivers allowed tools %q, the agent is started with %q", got, want)
	}
	for i, arg := range args {
		if arg == "--disallowedTools" && i+1 < len(args) {
			passed = args[i+1]
		}
	}
	if passed == "" {
		t.Fatal("the spawn passes no --disallowedTools, so there is nothing to compare with")
	}
	if got := strings.Join(state.BlockedTools, ","); got != passed {
		t.Errorf("state delivers %q, the agent is started with %q", got, passed)
	}
	for _, tool := range []string{"Write", "Edit", "NotebookEdit", "Bash"} {
		found := false
		for _, blocked := range state.BlockedTools {
			found = found || blocked == tool
		}
		if !found {
			t.Errorf("%s is missing from the delivered deny list", tool)
		}
	}
}

// A line range appears only when the Read call itself carried offset and limit.
// The range in the answer's prose is not an input to this at all.
func TestAReadReportsLinesOnlyFromItsOwnOffsetAndLimit(t *testing.T) {
	read := func(name, input string) string {
		return `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"` + name + `","input":` + input + `}]}}`
	}
	bin := fakeClaude(t,
		read("Read", `{"file_path":"a.go","offset":10,"limit":20}`),
		read("Read", `{"file_path":"b.go"}`),
		read("Read", `{"file_path":"c.go","offset":5}`),
		read("Read", `{"file_path":"d.go","limit":50}`),
		read("Grep", `{"pattern":"x","offset":1,"limit":3}`),
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"See b.go lines 1-99."}}}`,
		`{"type":"result","subtype":"success","session_id":"s"}`,
	)
	var lines []string
	for _, step := range collect(t, bin, "q") {
		if step.Kind == "read" {
			lines = append(lines, step.Target+"="+step.Lines)
		}
	}
	want := []string{"a.go=10-29", "b.go=", "c.go=", "d.go=1-50", "x="}
	if !reflect.DeepEqual(lines, want) {
		t.Errorf("reads = %v, want %v", lines, want)
	}
}

// A tool the reader granted the agent shows up in the delivered allow list, so
// the reader can refuse to say "nothing written" for it.
func TestCompanionStateDeliversAGrantedPluginToolInTheAllowList(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	srv := httptest.NewServer((&Server{
		Registry:  reg,
		Assets:    fstest.MapFS{},
		Companion: &Companion{Root: reg.Root, Bin: fakeClaude(t), PluginsDir: installAgentPlugin(t, true)},
	}).Handler())
	defer srv.Close()

	res, err := readerGET(srv.URL + CompanionStatePath)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var state struct {
		AllowedTools []string `json:"allowedTools"`
	}
	if err := json.NewDecoder(res.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	want := facet.AgentToolName("sample", "fixture.pull")
	found := false
	for _, tool := range state.AllowedTools {
		found = found || strings.Contains(tool, want)
	}
	if !found {
		t.Errorf("allowed tools %v do not carry the granted %q", state.AllowedTools, want)
	}
}

// The settings page says per tool whether it can change. That answer is read
// from the state response, so the response has to tell the build's own lists
// apart from a tool a grant added: the granted tool is allowed and not fixed,
// every read tool and every denied tool is fixed.
func TestCompanionStateTellsSettledToolsFromGrantedOnes(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	srv := httptest.NewServer((&Server{
		Registry:  reg,
		Assets:    fstest.MapFS{},
		Companion: &Companion{Root: reg.Root, Bin: fakeClaude(t), PluginsDir: installAgentPlugin(t, true)},
	}).Handler())
	defer srv.Close()

	res, err := readerGET(srv.URL + CompanionStatePath)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var state struct {
		AllowedTools []string `json:"allowedTools"`
		BlockedTools []string `json:"blockedTools"`
		FixedTools   []string `json:"fixedTools"`
	}
	if err := json.NewDecoder(res.Body).Decode(&state); err != nil {
		t.Fatal(err)
	}
	fixed := map[string]bool{}
	for _, tool := range state.FixedTools {
		fixed[tool] = true
	}
	granted := facet.AgentToolName("sample", "fixture.pull")
	sawGranted := false
	for _, tool := range state.AllowedTools {
		if strings.Contains(tool, granted) {
			sawGranted = true
			if fixed[tool] {
				t.Errorf("the granted %q is reported as fixed", tool)
			}
			continue
		}
		if !fixed[tool] && tool != ragToolName {
			t.Errorf("allowed %q is neither fixed nor a grant nor the index tool", tool)
		}
	}
	// Precondition: the grant reached the allow list at all.
	if !sawGranted {
		t.Fatalf("allowed tools %v do not carry the granted %q", state.AllowedTools, granted)
	}
	if len(state.BlockedTools) == 0 {
		t.Fatal("the state delivers no deny list")
	}
	for _, tool := range state.BlockedTools {
		if !fixed[tool] {
			t.Errorf("denied %q is not reported as fixed", tool)
		}
	}
	if !fixed["Read"] {
		t.Errorf("Read is not reported as fixed: %v", state.FixedTools)
	}
}
