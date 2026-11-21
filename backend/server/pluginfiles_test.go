package server_test

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/facet-framework/atlas/backend/server"
)

func TestPluginPublicFilesAreServedAndInstallMetadataIsRefused(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"id":"acme-notes","name":"Acme","version":"1.0.0","api":0,"entry":"entry.js"}`
	files := map[string][]byte{
		"entry.js":        []byte("export default function(){}"),
		"assets/mark.svg": []byte("<svg></svg>"),
		"grants.json":     []byte(`{"tools":["repo.write"]}`),
		".source.json":    []byte(`{"kind":"local","where":"private-path"}`),
	}
	writePluginPackage(t, dir, "acme-notes", manifest, files, true)
	srv := &server.Server{PluginsDir: dir}
	for _, name := range []string{"entry.js", "assets/mark.svg", "plugin.json", "grants.json", ".source.json"} {
		t.Run(name, func(t *testing.T) {
			res := servePluginFile(t, srv, server.PluginFilesPrefix+"acme-notes/"+name)
			defer res.Body.Close()
			if name == "grants.json" || name == ".source.json" {
				if res.StatusCode != http.StatusForbidden {
					t.Fatalf("metadata status: %d", res.StatusCode)
				}
				return
			}
			want := files[name]
			if name == "plugin.json" {
				want = []byte(manifest)
			}
			body, err := io.ReadAll(res.Body)
			if err != nil || res.StatusCode != http.StatusOK || string(body) != string(want) {
				t.Fatalf("public file status=%d body=%q error=%v", res.StatusCode, body, err)
			}
		})
	}
}

func servePluginFile(t *testing.T, srv *server.Server, path string, opts ...func(*http.Request)) *http.Response {
	t.Helper()
	req := loopbackRequest(http.MethodGet, path, nil)
	for _, o := range opts {
		o(req)
	}
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return rec.Result()
}

// writePluginPackage lays a plugin directory down with plugin.json and every
// file named in files. When withSums is true, a SHA256SUMS covering
// plugin.json and every file in files is written too — the layout
// verifyServedPluginFile checks a served file against. A test proving a
// refusal that happens before that check ever runs (a foreign origin, a
// path outside allowedPluginPath, a containment escape) passes withSums as
// false: no SHA256SUMS means an install laid down by hand, served
// unchecked, and the earlier refusal is what the test is actually about.
func writePluginPackage(t *testing.T, dir, id, manifest string, files map[string][]byte, withSums bool) {
	t.Helper()
	pdir := filepath.Join(dir, id)
	if err := os.MkdirAll(pdir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(pdir, "plugin.json"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("write plugin.json: %v", err)
	}
	for name, body := range files {
		full := filepath.Join(pdir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatalf("mkdir for %s: %v", name, err)
		}
		if err := os.WriteFile(full, body, 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if !withSums {
		return
	}
	var b strings.Builder
	sum := func(body []byte) string {
		s := sha256.Sum256(body)
		return hex.EncodeToString(s[:])
	}
	b.WriteString(sum([]byte(manifest)) + "  plugin.json\n")
	for name, body := range files {
		b.WriteString(sum(body) + "  " + name + "\n")
	}
	if err := os.WriteFile(filepath.Join(pdir, "SHA256SUMS"), []byte(b.String()), 0o644); err != nil {
		t.Fatalf("write SHA256SUMS: %v", err)
	}
}

// writeSHA256SumsFor writes a SHA256SUMS covering exactly the given files,
// measured — for a fixture that needs one written beside content that is
// then changed afterwards, so the measurement is of the ORIGINAL bytes, not
// whatever is on disk when the caller is done setting up.
func writeSHA256SumsFor(t *testing.T, dir string, files map[string][]byte) {
	t.Helper()
	var b strings.Builder
	for name, body := range files {
		s := sha256.Sum256(body)
		b.WriteString(hex.EncodeToString(s[:]) + "  " + name + "\n")
	}
	if err := os.WriteFile(filepath.Join(dir, "SHA256SUMS"), []byte(b.String()), 0o644); err != nil {
		t.Fatalf("write SHA256SUMS: %v", err)
	}
}

func TestAPluginFileFromAForeignOriginIsRefused(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"id":"acme-notes","name":"Acme","version":"1.0.0","api":0,"entry":"entry.js"}`
	writePluginPackage(t, dir, "acme-notes", manifest,
		map[string][]byte{"entry.js": []byte("export default function(){}")}, false)

	srv := &server.Server{PluginsDir: dir}
	res := servePluginFile(t, srv, server.PluginFilesPrefix+"acme-notes/entry.js", func(r *http.Request) {
		r.Header.Set("Origin", "https://example.com")
	})

	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("a foreign origin read a plugin file: %d", res.StatusCode)
	}
}

// Named runnable mutation: delete the `!allowedPluginPath(sub)` check in
// pluginfiles.go — grants.json is then served like any other file and this
// test goes red.
func TestGrantsJSONIsNeverServed(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"id":"acme-notes","name":"Acme","version":"1.0.0","api":0,"entry":"entry.js"}`
	writePluginPackage(t, dir, "acme-notes", manifest,
		map[string][]byte{
			"entry.js":    []byte("export default function(){}"),
			"grants.json": []byte(`{"tools":["repo.write"]}`),
		}, false)

	srv := &server.Server{PluginsDir: dir}
	res := servePluginFile(t, srv, server.PluginFilesPrefix+"acme-notes/grants.json")

	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("grants.json was served: %d", res.StatusCode)
	}
}

// Named runnable mutation: delete the SHA256SUMS comparison block in
// verifyServedPluginFile (pluginfiles.go) — a changed entry module is then
// served unchecked and this test goes red.
func TestAnEntryModuleThatDoesNotMatchItsRecordedChecksumIsRefused(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"id":"acme-notes","name":"Acme","version":"1.0.0","api":0,"entry":"entry.js"}`
	writePluginPackage(t, dir, "acme-notes", manifest,
		map[string][]byte{"entry.js": []byte("export default function(){}")}, true)
	// Rewritten AFTER SHA256SUMS was measured against the original content —
	// standing in for the entry having been edited on disk after install, by
	// anything other than `facet plugin update`.
	if err := os.WriteFile(filepath.Join(dir, "acme-notes", "entry.js"), []byte("export default function(){ /* edited */ }"), 0o644); err != nil {
		t.Fatalf("rewrite entry.js: %v", err)
	}

	srv := &server.Server{PluginsDir: dir}
	res := servePluginFile(t, srv, server.PluginFilesPrefix+"acme-notes/entry.js")

	if res.StatusCode != http.StatusConflict {
		t.Fatalf("a mismatched entry module was served: %d", res.StatusCode)
	}
}

// Named runnable mutation: in verifyServedPluginFile, change
// `sums[sub]` to a hardcoded `sums["entry.js"]` — the requested file is then
// checked against the ENTRY's own checksum rather than its own, and this
// second module is refused with a mismatch even though its own checksum
// matches. Before this route checked every file against SHA256SUMS (rather
// than only the one declared entry, per isPluginEntryModule's extension-only
// test), a second module was served with no check at all; this proves that
// gap is closed the right way — checked, not merely refused.
func TestASecondModuleListedInSumsIsServedWhenItMatches(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"id":"acme-notes","name":"Acme","version":"1.0.0","api":0,"entry":"entry.js"}`
	writePluginPackage(t, dir, "acme-notes", manifest,
		map[string][]byte{
			"entry.js":  []byte("export default function(){}"),
			"helper.js": []byte("export function helper(){ return 1; }"),
		}, true)

	srv := &server.Server{PluginsDir: dir}
	res := servePluginFile(t, srv, server.PluginFilesPrefix+"acme-notes/helper.js")

	if res.StatusCode != http.StatusOK {
		t.Fatalf("a second module listed in SHA256SUMS and matching it was refused: %d", res.StatusCode)
	}
}

// Named runnable mutation: change `sums[sub]`'s `listed` bool in
// verifyServedPluginFile to always true — a file the package's own
// SHA256SUMS never named (added to the directory after install, by anything
// other than `facet plugin update`) is then served and this test goes red.
func TestAFileNotListedInSumsIsRefused(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"id":"acme-notes","name":"Acme","version":"1.0.0","api":0,"entry":"entry.js"}`
	writePluginPackage(t, dir, "acme-notes", manifest,
		map[string][]byte{"entry.js": []byte("export default function(){}")}, true)
	// Added to the directory AFTER SHA256SUMS was written — never named by
	// the install's own record of the package's content.
	if err := os.WriteFile(filepath.Join(dir, "acme-notes", "smuggled.js"), []byte("export default function(){}"), 0o644); err != nil {
		t.Fatalf("write smuggled.js: %v", err)
	}

	srv := &server.Server{PluginsDir: dir}
	res := servePluginFile(t, srv, server.PluginFilesPrefix+"acme-notes/smuggled.js")

	if res.StatusCode == http.StatusOK {
		t.Fatal("a file absent from SHA256SUMS was served")
	}
}

// Named runnable mutation: replace the `filepath.EvalSymlinks(target)` call in
// pluginfiles.go with `target` itself (skip resolving) — a symlink placed
// inside the plugin's own directory that points outside it is then served
// and this test goes red.
func TestASymlinkInsideAPluginDirectoryPointingOutsideItIsRefused(t *testing.T) {
	dir := t.TempDir()
	secret := t.TempDir()
	if err := os.WriteFile(filepath.Join(secret, "passwords.txt"), []byte("hunter2"), 0o644); err != nil {
		t.Fatalf("write secret: %v", err)
	}
	manifest := `{"id":"acme-notes","name":"Acme","version":"1.0.0","api":0,"entry":"entry.js"}`
	writePluginPackage(t, dir, "acme-notes", manifest,
		map[string][]byte{"entry.js": []byte("export default function(){}")}, false)
	if err := os.MkdirAll(filepath.Join(dir, "acme-notes", "assets"), 0o755); err != nil {
		t.Fatalf("mkdir assets: %v", err)
	}
	if err := os.Symlink(filepath.Join(secret, "passwords.txt"), filepath.Join(dir, "acme-notes", "assets", "escape.png")); err != nil {
		t.Fatalf("symlink: %v", err)
	}

	srv := &server.Server{PluginsDir: dir}
	res := servePluginFile(t, srv, server.PluginFilesPrefix+"acme-notes/assets/escape.png")

	if res.StatusCode == http.StatusOK {
		t.Fatal("a symlink escaping the plugin directory was served")
	}
}

// Named runnable mutation: change the `..` guard in allowedPluginPath (via
// path.Clean) to accept a leading ".." — a path-traversal request then
// resolves outside the plugin root and, absent the containment check this
// test is really guarding end-to-end, would be served.
func TestAPathTraversalRequestIsRefused(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"id":"acme-notes","name":"Acme","version":"1.0.0","api":0,"entry":"entry.js"}`
	writePluginPackage(t, dir, "acme-notes", manifest,
		map[string][]byte{"entry.js": []byte("export default function(){}")}, false)
	if err := os.WriteFile(filepath.Join(dir, "outside.txt"), []byte("secret"), 0o644); err != nil {
		t.Fatalf("write outside file: %v", err)
	}

	srv := &server.Server{PluginsDir: dir}
	res := servePluginFile(t, srv, server.PluginFilesPrefix+"acme-notes/../outside.txt")

	if res.StatusCode == http.StatusOK {
		t.Fatal("a path-traversal request was served")
	}
}

// Named runnable mutation: delete the `pluginRoot, err := filepath.EvalSymlinks(...)`
// call's error check in pluginfiles.go (or the `--dev` handling that made it
// necessary) — a --dev install must still be servable through the same
// route, and this proves the positive side of the containment logic, not
// only its refusals.
func TestADevInstallsEntryModuleIsServedThroughTheSymlink(t *testing.T) {
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

	if err := os.WriteFile(filepath.Join(dir, "local-dev..source.json"), []byte(`{"dev":true}`), 0o644); err != nil {
		t.Fatalf("write .source.json: %v", err)
	}

	srv := &server.Server{PluginsDir: dir}
	res := servePluginFile(t, srv, server.PluginFilesPrefix+"local-dev/entry.js")

	if res.StatusCode != http.StatusOK {
		t.Fatalf("a --dev install's entry module was refused: %d", res.StatusCode)
	}
}

func TestADevInstallWithAWorkingCopyEditAfterInstallIsStillServed(t *testing.T) {
	dir := t.TempDir()
	work := t.TempDir()
	if err := os.WriteFile(filepath.Join(work, "plugin.json"), []byte(`{"id":"local-dev","name":"Local Dev","version":"0.1.0","api":0,"entry":"entry.js"}`), 0o644); err != nil {
		t.Fatalf("write plugin.json: %v", err)
	}
	if err := os.WriteFile(filepath.Join(work, "entry.js"), []byte("export default function(){}"), 0o644); err != nil {
		t.Fatalf("write entry.js: %v", err)
	}

	writeSHA256SumsFor(t, work, map[string][]byte{
		"plugin.json": []byte(`{"id":"local-dev","name":"Local Dev","version":"0.1.0","api":0,"entry":"entry.js"}`),
		"entry.js":    []byte("export default function(){}"),
	})
	if err := os.Symlink(work, filepath.Join(dir, "local-dev")); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "local-dev..source.json"), []byte(`{"dev":true}`), 0o644); err != nil {
		t.Fatalf("write .source.json: %v", err)
	}
	// Edited after install — the exact case a fixed sum would refuse and a
	// dev install must not.
	if err := os.WriteFile(filepath.Join(work, "entry.js"), []byte("export default function(){ /* edited live */ }"), 0o644); err != nil {
		t.Fatalf("rewrite entry.js: %v", err)
	}

	srv := &server.Server{PluginsDir: dir}
	res := servePluginFile(t, srv, server.PluginFilesPrefix+"local-dev/entry.js")

	if res.StatusCode != http.StatusOK {
		t.Fatalf("a --dev install's freshly edited working copy was refused: %d", res.StatusCode)
	}
}

// Every response this route serves must refuse to run as a script on its
// own — a plugin's asset (an .svg, say) opened directly rather than through
// import() would otherwise execute on this reader's origin. Two headers
// carry that: nosniff stops a browser guessing past the declared
// Content-Type, and the route's own CSP denies everything a navigated-to
// document could do.
func TestEveryPluginFileResponseCarriesItsOwnSecurityHeaders(t *testing.T) {
	dir := t.TempDir()
	manifest := `{"id":"acme-notes","name":"Acme","version":"1.0.0","api":0,"entry":"entry.js"}`
	writePluginPackage(t, dir, "acme-notes", manifest,
		map[string][]byte{
			"entry.js":        []byte("export default function(){}"),
			"assets/mark.svg": []byte("<svg><script>alert(1)</script></svg>"),
		}, true)

	srv := &server.Server{PluginsDir: dir}

	for _, path := range []string{
		server.PluginFilesPrefix + "acme-notes/entry.js",
		server.PluginFilesPrefix + "acme-notes/assets/mark.svg",
	} {
		res := servePluginFile(t, srv, path)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s: status = %d, want 200", path, res.StatusCode)
		}
		if got := res.Header.Get("X-Content-Type-Options"); got != "nosniff" {
			t.Fatalf("%s: X-Content-Type-Options = %q, want nosniff", path, got)
		}
		if got := res.Header.Get("Content-Security-Policy"); got == "" {
			t.Fatalf("%s: no Content-Security-Policy header at all", path)
		} else if !strings.Contains(got, "default-src 'none'") {
			t.Fatalf("%s: Content-Security-Policy = %q, want default-src 'none'", path, got)
		}
	}
}
