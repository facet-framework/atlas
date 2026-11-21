package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestRecordIDGrammar(t *testing.T) {
	valid := []string{
		"tasks/create/quick-add",
		"policy/data/local-first-storage",
		"assumption/sync/clock-skew-bounded",
		"a/b/c1",
	}
	for _, id := range valid {
		if !recordIDRe.MatchString(id) {
			t.Errorf("%q should be a record id", id)
		}
	}

	invalid := []string{
		"",
		"tasks/create",
		"tasks/create/quick-add/extra",
		"Tasks/Create/Quick-Add",
		"1tasks/create/quick-add",
		// The address is built by string concatenation, so anything that could
		// carry a second fragment or a scheme has to be refused here.
		"tasks/create/quick-add#other",
		"javascript:alert(1)",
	}
	for _, id := range invalid {
		if recordIDRe.MatchString(id) {
			t.Errorf("%q should not pass as a record id", id)
		}
	}
}

// runUI runs 'facet ui …' against a root and returns what it printed.
func runUI(t *testing.T, root string, args ...string) (string, error) {
	t.Helper()
	cmd := newRootCmd()
	var out strings.Builder
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs(append([]string{"ui", "--root", root, "--no-open"}, args...))

	done := make(chan error, 1)
	go func() { done <- cmd.Execute() }()
	select {
	case err := <-done:
		return out.String(), err
	case <-time.After(5 * time.Second):
		t.Fatalf("'facet ui %v' did not return: it went past the guard and started serving", args)
		return "", nil
	}
}

// The case above checks the grammar. This one checks that the command
// applies it — and it is not decoration: deleting the guard from server.go
// leaves TestRecordIDGrammar green, `go vet` at 0 and `go test ./cmd/...`
// passing. A grammar nobody consults refuses nothing.
func TestUIRefusesARecordIDItWouldNotPutInAnAddress(t *testing.T) {
	root := t.TempDir()
	record := filepath.Join(root, "docs/facets/features/demo/thing/widget.yaml")
	if err := os.MkdirAll(filepath.Dir(record), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(record, []byte(`schema_version: "0.1"
id: demo/thing/widget
lifecycle: planned
`), 0o644); err != nil {
		t.Fatal(err)
	}

	for _, bad := range []string{
		"tasks/create",
		"tasks/create/quick-add/extra",
		// The address is built by concatenation, so a value carrying its own
		// fragment or a scheme must not reach it.
		"tasks/create/quick-add#other",
		"javascript:alert(1)",
	} {
		out, err := runUI(t, root, "--record", bad)
		if err == nil {
			t.Fatalf("%q was accepted as a record id; output: %s", bad, out)
		}
		if !strings.Contains(err.Error(), "is not a record id") {
			t.Errorf("%q: want the grammar's own sentence, got %v", bad, err)
		}
		// The sentence names the shape it expected, so the reader can fix the value.
		if !strings.Contains(err.Error(), "expected three lowercase segments, as in tasks/create/quick-add") {
			t.Errorf("%q: the refusal does not name the expected shape: %v", bad, err)
		}
	}
}

func TestUIExplainsMissingRecordsWithoutInventingACommand(t *testing.T) {
	_, err := runUI(t, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "docs/facets") || !strings.Contains(err.Error(), "--root") || strings.Contains(err.Error(), "facet init") {
		t.Fatalf("expected the records path and a supported root/adoption hint, got %v", err)
	}
}

// One server reads one registry. Without --registry it is the first in name
// order — Names() sorts, so atlas wins although facet is declared first — and
// the terminal names the others, so the choice is never silent.
func TestUINamesTheRegistriesItDoesNotServe(t *testing.T) {
	t.Setenv("PATH", t.TempDir()) // An embedded reader must not need Node or Git to start.
	root := t.TempDir()
	write := func(rel, body string) {
		t.Helper()
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	record := "schema_version: \"0.1\"\nid: %s\nlifecycle: planned\n"
	write("docs/facets/facet/features/core/lint/check.yaml", fmt.Sprintf(record, "core/lint/check"))
	write("docs/facets/atlas/features/reader/view/page.yaml", fmt.Sprintf(record, "reader/view/page"))
	write(".facetrc.yaml", "registries:\n  facet:\n    records: docs/facets/facet\n  atlas:\n    records: docs/facets/atlas\n")

	for _, c := range []struct {
		args            []string
		served, unnamed string
	}{
		{nil, "atlas", "facet"},
		{[]string{"--registry", "facet"}, "facet", "atlas"},
	} {
		out := serveUntilReady(t, root, c.args...)
		if !strings.Contains(out, "Registry:    "+c.served+"\n") {
			t.Fatalf("%v: premise: %s is served, got:\n%s", c.args, c.served, out)
		}
		if want := "Not shown:   " + c.unnamed + " (open with --registry <name>)\n"; !strings.Contains(out, want) {
			t.Errorf("%v: want %q in the output, got:\n%s", c.args, want, out)
		}
	}

	single := t.TempDir()
	if err := os.MkdirAll(filepath.Join(single, "docs/facets/features/demo/thing"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(single, "docs/facets/features/demo/thing/widget.yaml"),
		[]byte(fmt.Sprintf(record, "demo/thing/widget")), 0o644); err != nil {
		t.Fatal(err)
	}
	out := serveUntilReady(t, single)
	if !strings.Contains(out, "Stop with Ctrl-C.") {
		t.Fatalf("premise: the single-registry reader started, got:\n%s", out)
	}
	if strings.Contains(out, "Not shown") {
		t.Errorf("a project with one registry has nothing to add, got:\n%s", out)
	}
}

// readyOutput collects what 'facet ui' prints and signals once the banner is
// complete; the server keeps writing from its own goroutine, hence the lock.
type readyOutput struct {
	mu    sync.Mutex
	text  strings.Builder
	ready chan struct{}
	once  sync.Once
}

func (w *readyOutput) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.text.Write(p)
	if strings.Contains(w.text.String(), "Stop with Ctrl-C.") {
		w.once.Do(func() { close(w.ready) })
	}
	return len(p), nil
}

func (w *readyOutput) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.text.String()
}

// serveUntilReady starts 'facet ui' on a free port, waits for the banner, stops
// the server and returns everything it printed.
func serveUntilReady(t *testing.T, root string, args ...string) string {
	t.Helper()
	cmd := newRootCmd()
	out := &readyOutput{ready: make(chan struct{})}
	cmd.SetOut(out)
	cmd.SetErr(out)
	cmd.SetArgs(append([]string{"ui", "--root", root, "--no-open", "--port", "0",
		"--companion-bin", filepath.Join(root, "no-agent")}, args...))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- cmd.ExecuteContext(ctx) }()
	select {
	case <-out.ready:
	case err := <-done:
		t.Fatalf("'facet ui %v' exited before serving: %v\n%s", args, err, out)
	case <-time.After(5 * time.Second):
		t.Fatalf("'facet ui %v' printed no complete banner:\n%s", args, out)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("'facet ui %v' did not stop cleanly: %v", args, err)
		}
	case <-time.After(3 * time.Second):
		t.Errorf("'facet ui %v' did not stop after context cancellation", args)
	}
	return out.String()
}
