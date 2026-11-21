// Fixtures here carry example BPMN content; the file demonstrates the route
// rather than implementing anything.
// @facet-ignore-file
package server

import (
	"encoding/json"
	"github.com/facet-framework/core/registry"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTheBundledBpmnPluginReadsItsDiagramsAndNothingElse(t *testing.T) {
	reg := registryProject(t)
	dir := filepath.Join(reg.Root, "docs", "bpmn")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	const xml = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"/>`
	for name, body := range map[string]string{"order.bpmn": xml, "notes.md": "# no", "secret.env": "SECRET=1"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	srv := &Server{Registry: reg, PluginsDir: t.TempDir()}

	call := func(body string) map[string]json.RawMessage {
		t.Helper()
		req := loopbackRequest(http.MethodPost, PluginCallPath, strings.NewReader(body))
		authorizePluginRequest(t, srv, "bpmn", req)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		var out map[string]json.RawMessage
		if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
			t.Fatalf("the response is not JSON (%d): %v", rec.Code, err)
		}
		return out
	}

	var list struct {
		Files []repoReadEntry `json:"files"`
	}
	out := call(`{"plugin":"bpmn","tool":"repo.list","args":{"dir":"docs/bpmn"}}`)
	if err := json.Unmarshal(out["result"], &list); err != nil {
		t.Fatalf("repo.list: error=%s denied=%s", out["error"], out["denied"])
	}
	if len(list.Files) != 1 || list.Files[0].Path != "order.bpmn" || list.Files[0].Slug != "order" {
		t.Fatalf("repo.list = %+v, want exactly order.bpmn", list.Files)
	}

	var read struct {
		Body string `json:"body"`
	}
	out = call(`{"plugin":"bpmn","tool":"repo.read","args":{"dir":"docs/bpmn","path":"order.bpmn"}}`)
	if err := json.Unmarshal(out["result"], &read); err != nil || read.Body != xml {
		t.Fatalf("repo.read order.bpmn = %q (%s)", read.Body, out["error"])
	}

	// Beside it, in the same declared directory, neither the markdown nor
	// the secret is handed out.
	for _, path := range []string{"notes.md", "secret.env"} {
		out = call(`{"plugin":"bpmn","tool":"repo.read","args":{"dir":"docs/bpmn","path":"` + path + `"}}`)
		if _, ok := out["result"]; ok {
			t.Errorf("%s was read for the bpmn plugin: %s", path, out["result"])
		}
	}
}

func TestConfiguredBPMNDirectory(t *testing.T) {
	reg := registryProject(t)
	if err := os.WriteFile(filepath.Join(reg.Root, facet.ConfigName), []byte("bpmn:\n  directory: diagrams\n"), 0644); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Join(reg.Root, "diagrams"), 0755)
	os.WriteFile(filepath.Join(reg.Root, "diagrams", "order.bpmn"), []byte("<definitions/>"), 0644)
	os.WriteFile(filepath.Join(reg.Root, "diagrams", "notes.md"), []byte("private"), 0644)
	srv := &Server{Registry: reg, PluginsDir: t.TempDir()}
	got, err := srv.hostRepoList("bpmn", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(got)
	var list struct {
		Dir   string          `json:"dir"`
		Files []repoReadEntry `json:"files"`
	}
	json.Unmarshal(raw, &list)
	if list.Dir != "diagrams" || len(list.Files) != 1 || list.Files[0].Path != "order.bpmn" {
		t.Fatalf("configured list: %s", raw)
	}
	if _, err := srv.hostRepoRead("bpmn", json.RawMessage(`{"path":"order.bpmn"}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.hostRepoRead("bpmn", json.RawMessage(`{"path":"notes.md"}`)); err == nil {
		t.Fatal("read Markdown outside extension grant")
	}
	if _, err := srv.hostRepoList("bpmn", json.RawMessage(`{"dir":"docs/bpmn"}`)); err == nil {
		t.Fatal("accepted old directory")
	}
}
