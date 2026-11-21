package server_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/facet-framework/atlas/backend/server"
)

// installedPluginsResponse mirrors the JSON /api/plugins answers — only the
// fields these tests read.
type installedPluginsResponse struct {
	Plugins []struct {
		ID           string   `json:"id"`
		Name         string   `json:"name"`
		Version      string   `json:"version"`
		API          int      `json:"api"`
		Entry        string   `json:"entry"`
		Areas        []string `json:"areas"`
		Slots        []string `json:"slots"`
		Dev          bool     `json:"dev"`
		Kind         string   `json:"kind"`
		Where        string   `json:"where"`
		Verification string   `json:"verification"`
	} `json:"plugins"`
}

func writePluginVerified(t *testing.T, dir, id, manifest, entry string) {
	t.Helper()
	pdir := filepath.Join(dir, id)
	if err := os.MkdirAll(pdir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(pdir, "plugin.json"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("write plugin.json: %v", err)
	}
	if entry == "" {
		return
	}
	if err := os.WriteFile(filepath.Join(pdir, "entry.js"), []byte(entry), 0o644); err != nil {
		t.Fatalf("write entry.js: %v", err)
	}
	writeSHA256SUMS(t, pdir, manifest, entry)
}

func writeSHA256SUMS(t *testing.T, pdir, manifest, entry string) {
	t.Helper()
	sumManifest := sha256.Sum256([]byte(manifest))
	sumEntry := sha256.Sum256([]byte(entry))
	sums := hex.EncodeToString(sumManifest[:]) + "  plugin.json\n" +
		hex.EncodeToString(sumEntry[:]) + "  entry.js\n"
	if err := os.WriteFile(filepath.Join(pdir, "SHA256SUMS"), []byte(sums), 0o644); err != nil {
		t.Fatalf("write SHA256SUMS: %v", err)
	}
}

func listPlugins(t *testing.T, srv *server.Server) installedPluginsResponse {
	t.Helper()
	req := loopbackRequest(http.MethodGet, server.InstalledPluginsPath, nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	res := rec.Result()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("listing plugins: %d", res.StatusCode)
	}
	var out installedPluginsResponse
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("the response is not JSON: %v", err)
	}
	return out
}

// Named runnable mutation: comment out the `mux.HandleFunc(InstalledPluginsPath, …)`
// line in server.go's Handler — the request then falls through to spaHandler
// and this test's status check goes red instead of finding an empty list.
func TestAnInstalledPluginIsListed(t *testing.T) {
	dir := t.TempDir()
	writePluginVerified(t, dir, "acme-notes",
		`{"id":"acme-notes","name":"Acme Notes","version":"1.0.0","api":0,"entry":"entry.js","areas":["notes"],"slots":["header.action"]}`,
		"export default function(){}")

	srv := &server.Server{PluginsDir: dir}
	out := listPlugins(t, srv)

	if len(out.Plugins) != 1 {
		t.Fatalf("want one listed plugin, got %d", len(out.Plugins))
	}
	p := out.Plugins[0]
	if p.ID != "acme-notes" || p.Name != "Acme Notes" || p.Version != "1.0.0" {
		t.Fatalf("wrong identity: %+v", p)
	}
	if p.Entry != "/plugins/acme-notes/entry.js" {
		t.Fatalf("entry is not a servable URL: %q", p.Entry)
	}
	if p.Verification != "ok" {
		t.Fatalf("a plain, matching manifest should verify ok, got %q", p.Verification)
	}
	if len(p.Areas) != 1 || p.Areas[0] != "notes" {
		t.Fatalf("areas lost: %+v", p.Areas)
	}
	if p.API != 0 || len(p.Slots) != 1 || p.Slots[0] != "header.action" || p.Dev {
		t.Fatalf("API, slots or installed state lost: %+v", p)
	}
}

func TestAnInstalledPluginSharingABundledIDIsReportedNotLoadable(t *testing.T) {
	dir := t.TempDir()
	writePluginVerified(t, dir, "adr", `{"id":"adr","name":"Impostor","version":"1.0.0","api":0,"entry":"entry.js"}`, "")

	srv := &server.Server{PluginsDir: dir}
	out := listPlugins(t, srv)

	if len(out.Plugins) != 1 {
		t.Fatalf("want one listed row even for the collision, got %d", len(out.Plugins))
	}
	if out.Plugins[0].Verification == "ok" {
		t.Fatal("a plugin claiming a bundled id must not verify ok")
	}
}

// Named runnable mutation: in installedplugins.go's verificationOf, change
// `errors.Is(ip.VerifyError, facet.ErrPluginAPIMismatch)` to always false —
// an unsupported api then reports "invalid" instead of "api-unsupported" and
// this test goes red.
func TestAPluginNamingAnUnsupportedAPIIsReportedNotOK(t *testing.T) {
	dir := t.TempDir()
	writePluginVerified(t, dir, "future-plugin",
		`{"id":"future-plugin","name":"From Later","version":"1.0.0","api":99,"entry":"entry.js"}`,
		"export default function(){}")

	srv := &server.Server{PluginsDir: dir}
	out := listPlugins(t, srv)

	if len(out.Plugins) != 1 || out.Plugins[0].Verification != "api-unsupported" {
		t.Fatalf("want api-unsupported, got %+v", out.Plugins)
	}
}

func TestAnEntryChangedSinceInstallIsReportedAsAMismatch(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"id":"acme-notes","name":"Acme Notes","version":"1.0.0","api":0,"entry":"entry.js"}`
	writePluginVerified(t, dir, "acme-notes", manifest, "export default function(){}")
	// Rewritten AFTER SHA256SUMS was measured against the original content —
	// standing in for the entry having been edited on disk after install,
	// by anything other than `facet plugin update`.
	if err := os.WriteFile(filepath.Join(dir, "acme-notes", "entry.js"), []byte("export default function(){ /* edited */ }"), 0o644); err != nil {
		t.Fatalf("rewrite entry.js: %v", err)
	}

	srv := &server.Server{PluginsDir: dir}
	out := listPlugins(t, srv)

	if len(out.Plugins) != 1 || out.Plugins[0].Verification != "checksum-mismatch" {
		t.Fatalf("want checksum-mismatch, got %+v", out.Plugins)
	}
}

func TestADevInstallIsMarkedDevAndNeverAsAMismatch(t *testing.T) {
	dir := t.TempDir()
	work := t.TempDir()
	if err := os.WriteFile(filepath.Join(work, "plugin.json"), []byte(`{"id":"local-dev","name":"Local Dev","version":"0.1.0","api":0,"entry":"entry.js"}`), 0o644); err != nil {
		t.Fatalf("write plugin.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(work, "entry.js"), []byte("export default function(){}"), 0o644); err != nil {
		t.Fatalf("write entry.js: %v", err)
	}
	if err := os.Symlink(work, filepath.Join(dir, "local-dev")); err != nil {
		t.Fatalf("symlink: %v", err)
	}

	source := `{"dev":true,"kind":"local","where":"` + work + `"}`
	if err := os.WriteFile(filepath.Join(dir, "local-dev..source.json"), []byte(source), 0o644); err != nil {
		t.Fatalf("write .source.json: %v", err)
	}

	srv := &server.Server{PluginsDir: dir}
	out := listPlugins(t, srv)

	if len(out.Plugins) != 1 {
		t.Fatalf("want one listed plugin, got %+v", out.Plugins)
	}
	p := out.Plugins[0]
	if !p.Dev {
		t.Fatal("a --dev install must be marked dev")
	}
	if p.Verification != "ok" {
		t.Fatalf("a dev install with no fixed sums must not fail verification, got %q", p.Verification)
	}
	if p.Kind != "local" || p.Where != work {
		t.Fatalf("source metadata lost: %+v", p)
	}
}

// Named runnable mutation: in installedplugins.go's verificationOf, change
// the `default: return "invalid"` branch to `return "ok"` — a broken
// manifest then verifies ok and this test goes red.
func TestAPluginWithAMalformedManifestIsReportedInvalid(t *testing.T) {
	dir := t.TempDir()
	writePluginVerified(t, dir, "broken", `{ this is not json`, "")

	srv := &server.Server{PluginsDir: dir}
	out := listPlugins(t, srv)

	if len(out.Plugins) != 1 || out.Plugins[0].Verification != "invalid" {
		t.Fatalf("want invalid, got %+v", out.Plugins)
	}
}

func TestAnInstalledPluginNamedDifferentlyFromItsManifestIsNotLoadable(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"id":"acme-notes","name":"Acme Notes","version":"1.0.0","api":0,"entry":"entry.js"}`
	writePluginVerified(t, dir, "mismatched-dir-name", manifest, "export default function(){}")

	srv := &server.Server{PluginsDir: dir}
	out := listPlugins(t, srv)

	if len(out.Plugins) != 1 {
		t.Fatalf("want one listed row, got %+v", out.Plugins)
	}
	if out.Plugins[0].Verification == "ok" {
		t.Fatal("a directory whose manifest names a different id must not verify ok")
	}
}

// Named runnable mutation: remove the `s.PluginsDir == ""` guard so
// os.ReadDir is called with an empty string — os.ReadDir("") errors on every
// platform this runs on, but a version of this code that instead panicked or
// listed the working directory would turn this test red.
func TestWithoutAPluginDirectoryTheListIsEmpty(t *testing.T) {
	srv := &server.Server{}
	out := listPlugins(t, srv)
	if len(out.Plugins) != 0 {
		t.Fatalf("want no plugins with no directory configured, got %+v", out.Plugins)
	}
}
