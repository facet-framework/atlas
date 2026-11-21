package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// Exercise the file handler directly: ServeMux redirects doubled slashes before
// this boundary, which would make a router-only refusal test vacuous.
// Mutation: remove path.IsAbs from allowedPluginPath -> the second request is served.
func TestAnAbsolutePluginSubpathIsRefusedAtTheFileBoundary(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "acme-notes")
	if err := os.Mkdir(root, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"plugin.json": `{"id":"acme-notes","name":"Acme","version":"1.0.0","api":0,"entry":"entry.js"}`,
		"entry.js":    "export default function(){}",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	handler := pluginFilesHandler{dir: func() string { return dir }}
	for _, tc := range []struct {
		sub    string
		status int
	}{{"entry.js", http.StatusOK}, {"/entry.js", http.StatusForbidden}} {
		request := loopbackRequest(http.MethodGet, PluginFilesPrefix+"acme-notes/"+tc.sub, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != tc.status {
			t.Fatalf("subpath %q: %d %s", tc.sub, response.Code, response.Body.String())
		}
	}
}
