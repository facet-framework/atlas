package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Native Git Trace2 records subprocess arguments, including short-lived calls.
// The file belongs to this test; no user repository or shared trace is read.
func traceGitCommands(t *testing.T) (read func() [][]string, reset func()) {
	t.Helper()
	file := filepath.Join(t.TempDir(), "git-events.jsonl")
	t.Setenv("GIT_TRACE2_EVENT", file)
	read = func() [][]string {
		t.Helper()
		data, err := os.ReadFile(file)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			t.Fatal(err)
		}
		var calls [][]string
		for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
			if line == "" {
				continue
			}
			var event struct {
				Event string   `json:"event"`
				Argv  []string `json:"argv"`
			}
			if err := json.Unmarshal([]byte(line), &event); err != nil {
				t.Fatal(err)
			}
			if event.Event == "start" {
				calls = append(calls, event.Argv)
			}
		}
		return calls
	}
	reset = func() {
		t.Helper()
		if err := os.Remove(file); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
	}
	return
}
