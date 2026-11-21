package server

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/facet-framework/core/registry"
)

func TestDirectorySettings(t *testing.T) {
	root := t.TempDir()
	for _, args := range [][]string{{"init"}, {"config", "user.email", "hello@facet-framework.com"}, {"config", "user.name", "Test"}} {
		if _, err := directoryGit(root, args...); err != nil {
			t.Fatal(err)
		}
	}
	original := "# keep this comment\nadr:\n  directory: docs/decisions\n"
	os.WriteFile(filepath.Join(root, facet.ConfigName), []byte(original), 0644)
	directoryGit(root, "add", ".")
	directoryGit(root, "commit", "-m", "init")
	reg := facet.Registry{Root: root}
	srv := &Server{Registry: reg}
	call := func(body, origin string) (int, map[string]any) {
		t.Helper()
		r := loopbackRequest("POST", "http://localhost:3000/api/settings/directory", strings.NewReader(body))
		if origin != "" {
			r.Header.Set("Origin", origin)
		} else {
			r.Header.Set("Sec-Fetch-Site", "cross-site")
		}
		w := httptest.NewRecorder()
		srv.directorySettings(w, r)
		var out map[string]any
		json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}
	if code, _ := call(`{"kind":"adr"}`, ""); code != 403 {
		t.Fatalf("missing origin: %d", code)
	}
	if code, out := call(`{"kind":"adr"}`, "http://localhost:3000"); code != 200 || out["line"] != float64(3) || out["directory"] != "docs/decisions" {
		t.Fatalf("source %d %v", code, out)
	}
	if code, _ := call(`{"kind":"bpmn","directory":"../escape","mode":"checkout"}`, "http://localhost:3000"); code != 400 {
		t.Fatal("accepted escape")
	}
	if code, _ := call(`{"kind":"adr","directory":"docs/other","mode":"invalid"}`, "http://localhost:3000"); code != 400 {
		t.Fatal("accepted invalid mode")
	}
	if code, out := call(`{"kind":"bpmn","directory":"diagrams","mode":"checkout"}`, "http://localhost:3000"); code != 200 || out["dirty"] != true {
		t.Fatalf("write %d %v", code, out)
	}
	data, _ := os.ReadFile(filepath.Join(root, facet.ConfigName))
	if !strings.Contains(string(data), "# keep this comment") {
		t.Fatal("lost comment")
	}
	cfg, err := facet.LoadConfig(root)
	if err != nil || cfg.BPMNDirectory() != "diagrams" {
		t.Fatalf("config %v %v", cfg, err)
	}
	// Calling from a linked worktree must still target the main checkout.
	linked := filepath.Join(t.TempDir(), "linked")
	if _, err := directoryGit(root, "worktree", "add", "-b", "linked", linked); err != nil {
		t.Fatal(err)
	}
	srv.Registry.Root = linked
	if code, out := call(`{"kind":"adr","directory":"docs/new","mode":"worktree"}`, "http://localhost:3000"); code != 200 {
		t.Fatalf("worktree %d %v", code, out)
	} else {
		target := out["worktree"].(string)
		branch := out["branch"].(string)
		defer directoryGit(root, "branch", "-D", branch)
		defer directoryGit(root, "worktree", "remove", "--force", target)
		cfg, err := facet.LoadConfig(target)
		if err != nil || cfg.ADRDirectory() != "docs/new" {
			t.Fatal("worktree config", err)
		}
		unchanged, _ := os.ReadFile(filepath.Join(root, facet.ConfigName))
		if string(unchanged) != string(data) {
			t.Fatal("worktree changed main checkout")
		}
	}
	if code, out := call(`{"kind":"adr","directory":"docs/main","mode":"checkout"}`, "http://localhost:3000"); code != 200 || out["file"] != filepath.Join(root, facet.ConfigName) {
		t.Fatalf("main checkout %d %v", code, out)
	}
	cfg, _ = facet.LoadConfig(root)
	if cfg.ADRDirectory() != "docs/main" {
		t.Fatal("did not write main checkout")
	}
	// Never follow a configuration symlink during a write.
	configPath := filepath.Join(root, facet.ConfigName)
	outside := filepath.Join(t.TempDir(), "outside.yaml")
	os.WriteFile(outside, []byte("adr:\n  directory: docs/outside\n"), 0644)
	os.Remove(configPath)
	if err := os.Symlink(outside, configPath); err != nil {
		t.Fatal(err)
	}
	if code, _ := call(`{"kind":"adr","directory":"docs/escape","mode":"checkout"}`, "http://localhost:3000"); code < 400 {
		t.Fatal("accepted configuration symlink")
	}
	content, _ := os.ReadFile(outside)
	if !strings.Contains(string(content), "docs/outside") {
		t.Fatal("changed external configuration")
	}

}

// directorySettingsRepo lays down a committed repository whose .facetrc.yaml
// holds exactly `config` — or no configuration file at all when it is empty —
// and returns a server reading it together with the request helper the
// settings route is driven through.
func directorySettingsRepo(t *testing.T, config string) (string, *Server, func(body string) (int, map[string]any)) {
	t.Helper()
	root := t.TempDir()
	for _, args := range [][]string{{"init"}, {"config", "user.email", "hello@facet-framework.com"}, {"config", "user.name", "Test"}} {
		if _, err := directoryGit(root, args...); err != nil {
			t.Fatal(err)
		}
	}
	if config != "" {
		if err := os.WriteFile(filepath.Join(root, facet.ConfigName), []byte(config), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("fixture\n"), 0644); err != nil {
		t.Fatal(err)
	}
	directoryGit(root, "add", ".")
	if _, err := directoryGit(root, "commit", "-m", "init"); err != nil {
		t.Fatal(err)
	}
	srv := &Server{Registry: facet.Registry{Root: root}}
	call := func(body string) (int, map[string]any) {
		t.Helper()
		r := loopbackRequest("POST", "http://localhost:3000/api/settings/directory", strings.NewReader(body))
		r.Header.Set("Origin", "http://localhost:3000")
		w := httptest.NewRecorder()
		srv.directorySettings(w, r)
		var out map[string]any
		json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}
	return root, srv, call
}

// An absent key is reported as line 0 with the built-in default, so the
// settings page can say "not set yet" and show the entry to add — rather than
// pointing at a line that does not exist. Both the case of a configuration
// without the section and the case of no configuration file at all.
func TestDirectorySettingsReportsAnAbsentKey(t *testing.T) {
	_, _, call := directorySettingsRepo(t, "# only adr is configured\nadr:\n  directory: docs/decisions\n")
	code, out := call(`{"kind":"bpmn"}`)
	if code != 200 {
		t.Fatalf("absent bpmn key: %d %v", code, out)
	}
	if out["line"] != float64(0) || out["directory"] != "docs/bpmn" || out["key"] != "bpmn.directory" || out["file"] != facet.ConfigName {
		t.Fatalf("absent bpmn key was not reported as unset with its default: %v", out)
	}

	_, _, call = directorySettingsRepo(t, "")
	code, out = call(`{"kind":"adr"}`)
	if code != 200 {
		t.Fatalf("absent configuration: %d %v", code, out)
	}
	if out["line"] != float64(0) || out["directory"] != "docs/adr" || out["key"] != "adr.directory" {
		t.Fatalf("absent adr key was not reported as unset with its default: %v", out)
	}

	// The counter-case, so that 0 is read as "absent" and not as the answer
	// for every bpmn key: a present key reports the line it stands on.
	_, _, call = directorySettingsRepo(t, "adr:\n  directory: docs/decisions\n# diagrams live here\nbpmn:\n  directory: diagrams\n")
	code, out = call(`{"kind":"bpmn"}`)
	if code != 200 {
		t.Fatalf("present bpmn key: %d %v", code, out)
	}
	if out["line"] != float64(5) || out["directory"] != "diagrams" || out["key"] != "bpmn.directory" {
		t.Fatalf("present bpmn key was not reported with its line: %v", out)
	}
}

// The BPMN kind takes the worktree path too — TestDirectorySettings drives
// worktree mode with kind adr only, and the kind decides the branch name and
// the key that is written.
func TestDirectorySettingsWritesABpmnWorktree(t *testing.T) {
	root, _, call := directorySettingsRepo(t, "# keep this comment\nbpmn:\n  directory: docs/bpmn\n")
	before, err := os.ReadFile(filepath.Join(root, facet.ConfigName))
	if err != nil {
		t.Fatal(err)
	}
	code, out := call(`{"kind":"bpmn","directory":"diagrams","mode":"worktree"}`)
	if code != 200 {
		t.Fatalf("bpmn worktree: %d %v", code, out)
	}
	target, _ := out["worktree"].(string)
	branch, _ := out["branch"].(string)
	if target == "" || target == root || !strings.HasPrefix(branch, "atlas/bpmn-directory-") {
		t.Fatalf("no bpmn worktree and branch were reported: %v", out)
	}
	defer directoryGit(root, "branch", "-D", branch)
	defer directoryGit(root, "worktree", "remove", "--force", target)
	if out["file"] != filepath.Join(target, facet.ConfigName) {
		t.Fatalf("the written file is not the worktree's configuration: %v", out)
	}
	cfg, err := facet.LoadConfig(target)
	if err != nil || cfg.BPMNDirectory() != "diagrams" {
		t.Fatalf("worktree config: %v %v", cfg, err)
	}
	written, _ := os.ReadFile(filepath.Join(target, facet.ConfigName))
	if !strings.Contains(string(written), "# keep this comment") {
		t.Fatal("the worktree write lost the comment")
	}
	after, _ := os.ReadFile(filepath.Join(root, facet.ConfigName))
	if string(after) != string(before) {
		t.Fatal("the bpmn worktree write changed the main checkout")
	}
	if cfg, _ := facet.LoadConfig(root); cfg.BPMNDirectory() != "docs/bpmn" {
		t.Fatal("the main checkout must still read its own BPMN directory")
	}
}
