// Fixtures here carry example ADR content and example @facet: tags; the file
// demonstrates the routes rather than implementing anything, so it opts out
// of scanning.
// @facet-ignore-file
package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/facet-framework/core/registry"
)

const sampleAdrBody = `# ADR 0001 — Title

**Status:** accepted

---

## 1. Decision

Text.
`

// repoReadServer builds a server with a bundled plugin directory (t.TempDir,
// unused directly — the "adr" manifest is answered from the embedded
// bundledManifests table, not read from disk) so hostRepoList/hostRepoRead
// resolve their declared directory through the plugin id the way the real
// call route does, rather than through a directory a test hands them
// directly.
func repoReadServer(t *testing.T, files map[string]string) *Server {
	t.Helper()
	reg := registryProject(t)
	for name, body := range files {
		p := filepath.Join(reg.Root, "docs", "adr", name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return &Server{Registry: reg, PluginsDir: t.TempDir()}
}

func TestHostRepoListListsFilesWithNumberAndSlug(t *testing.T) {
	srv := repoReadServer(t, map[string]string{
		"0001-offline-first-storage.md": sampleAdrBody,
		"0002-sync-conflicts.md":        sampleAdrBody,
	})

	args, _ := json.Marshal(map[string]string{"dir": "docs/adr"})
	result, err := srv.hostRepoList("adr", args)
	if err != nil {
		t.Fatalf("hostRepoList: %v", err)
	}
	raw, _ := json.Marshal(result)
	var out struct {
		Dir   string          `json:"dir"`
		Files []repoReadEntry `json:"files"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("hostRepoList result is not the shape expected: %v", err)
	}
	if len(out.Files) != 2 {
		t.Fatalf("hostRepoList found %d entries, want 2", len(out.Files))
	}
	if out.Files[0].Number != "0001" || out.Files[0].Slug != "offline-first-storage" {
		t.Errorf("hostRepoList[0] = %+v, want number 0001, slug offline-first-storage", out.Files[0])
	}
}

func TestHostRepoReadReadsTheNamedFile(t *testing.T) {
	srv := repoReadServer(t, map[string]string{"0001-title.md": sampleAdrBody})

	args, _ := json.Marshal(map[string]string{"dir": "docs/adr", "path": "0001-title.md"})
	result, err := srv.hostRepoRead("adr", args)
	if err != nil {
		t.Fatalf("hostRepoRead: %v", err)
	}
	raw, _ := json.Marshal(result)
	var out struct {
		Body string `json:"body"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("hostRepoRead result is not the shape expected: %v", err)
	}
	if out.Body != sampleAdrBody {
		t.Errorf("hostRepoRead returned %q, want the file's own content", out.Body)
	}
}

// The refusal this tool has to carry itself, the same shape repo_read_tools_test.go
// also checks: a path leaving the declared directory must not be
// readable through this door, however the caller spells it.
func TestHostRepoReadRefusesAPathOutsideTheDeclaredDirectory(t *testing.T) {
	srv := repoReadServer(t, map[string]string{"0001-title.md": sampleAdrBody})

	args, _ := json.Marshal(map[string]string{"dir": "docs/adr", "path": "../../.facetrc.yaml"})
	if _, err := srv.hostRepoRead("adr", args); err == nil {
		t.Fatal("hostRepoRead allowed a path outside docs/adr")
	}
}

func TestHostRepoListOfAMissingDirectoryAnswersNoneNotAnError(t *testing.T) {
	srv := repoReadServer(t, nil)

	args, _ := json.Marshal(map[string]string{"dir": "docs/adr"})
	result, err := srv.hostRepoList("adr", args)
	if err != nil {
		t.Fatalf("hostRepoList of a project with no docs/adr: %v", err)
	}
	raw, _ := json.Marshal(result)
	var out struct {
		Files []repoReadEntry `json:"files"`
	}
	_ = json.Unmarshal(raw, &out)
	if len(out.Files) != 0 {
		t.Errorf("hostRepoList of a project with no docs/adr = %v, want none", out.Files)
	}
}

// The tool is scoped by the calling plugin's own manifest, not by a
// directory it hands over freely: a directory absent from Reads is refused
// exactly the way an undeclared tool already is.
func TestHostRepoListRefusesADirectoryTheManifestDidNotDeclare(t *testing.T) {
	srv := repoReadServer(t, map[string]string{"0001-title.md": sampleAdrBody})

	args, _ := json.Marshal(map[string]string{"dir": "docs/adr/../secrets"})
	if _, err := srv.hostRepoList("adr", args); err == nil {
		t.Fatal("hostRepoList allowed a directory the manifest never declared under \"reads\"")
	}
}

// hostRepoList and hostRepoRead are keyed by capability, and the id a caller
// asks with is the one the manifest is read for — a plugin nobody bundled or
// installed is refused the same way any other tool call refuses it, not
// silently handed the ADR directory because the tool name happens to match.
func TestHostRepoListRefusesAPluginNobodyInstalled(t *testing.T) {
	srv := repoReadServer(t, map[string]string{"0001-title.md": sampleAdrBody})

	args, _ := json.Marshal(map[string]string{"dir": "docs/adr"})
	if _, err := srv.hostRepoList("no-such-plugin", args); err == nil {
		t.Fatal("hostRepoList answered for a plugin nobody installed")
	}
}

func installedReadsServer(t *testing.T, reads []string) *Server {
	t.Helper()
	srv := repoReadServer(t, nil)
	manifest, _ := json.Marshal(map[string]any{
		"id": "acme-notes", "tools": []string{"repo.list", "repo.read"}, "reads": reads,
	})
	p := filepath.Join(srv.PluginsDir, "acme-notes", "plugin.json")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	return srv
}

// The reviewer's probe: a plugin declaring ".." reads markdown next to the
// repository. Mutation: return filepath.Join(root, rel) from declaredReadDir
// instead of facet.ResolveReadDir → red.
func TestAnInstalledPluginCannotDeclareItsWayOutOfTheRepository(t *testing.T) {
	srv := installedReadsServer(t, []string{"..", "."})
	secret := filepath.Join(filepath.Dir(srv.Registry.Root), "secret.md")
	if err := os.WriteFile(secret, []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Precondition: the file really is where ".." would point.
	if _, err := os.Stat(filepath.Join(srv.Registry.Root, "..", "secret.md")); err != nil {
		t.Fatalf("fixture precondition: nothing to leak at ../secret.md: %v", err)
	}

	for _, dir := range []string{"..", "."} {
		args, _ := json.Marshal(map[string]string{"dir": dir})
		if _, err := srv.hostRepoList("acme-notes", args); err == nil {
			t.Errorf("repo.list answered for the declared directory %q", dir)
		}
	}
	args, _ := json.Marshal(map[string]string{"dir": "..", "path": "secret.md"})
	if res, err := srv.hostRepoRead("acme-notes", args); err == nil {
		t.Fatalf("repo.read returned a file outside the repository: %v", res)
	}
}

func TestThePluginCallRouteReachesRepoListAndRepoRead(t *testing.T) {
	srv := repoReadServer(t, map[string]string{"0001-title.md": sampleAdrBody})

	post := func(body string) map[string]json.RawMessage {
		t.Helper()
		req := loopbackRequest(http.MethodPost, PluginCallPath, strings.NewReader(body))
		authorizePluginRequest(t, srv, "adr", req)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		var out map[string]json.RawMessage
		if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
			t.Fatalf("the response is not JSON (%d): %v", rec.Code, err)
		}
		if _, refused := out["denied"]; refused {
			t.Fatalf("the call was denied: %s", out["denied"])
		}
		if _, failed := out["error"]; failed {
			t.Fatalf("the call failed: %s", out["error"])
		}
		return out
	}

	var list struct {
		Files []repoReadEntry `json:"files"`
	}
	if err := json.Unmarshal(post(`{"plugin":"adr","tool":"repo.list","args":{"dir":"docs/adr"}}`)["result"], &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Files) != 1 || list.Files[0].Path != "0001-title.md" {
		t.Fatalf("repo.list through the route = %+v, want the one file", list.Files)
	}

	var read struct {
		Body string `json:"body"`
	}
	if err := json.Unmarshal(post(`{"plugin":"adr","tool":"repo.read","args":{"dir":"docs/adr","path":"0001-title.md"}}`)["result"], &read); err != nil {
		t.Fatal(err)
	}
	if read.Body != sampleAdrBody {
		t.Fatalf("repo.read through the route = %q, want the file's content", read.Body)
	}
}

// --- "reads" with extensions (#dmn) ----------------------------------------

// extReadsServer is an installed plugin whose plugin.json declares the given
// raw "reads" entries (strings and/or objects), granted both tools, with
// files laid out under the repository root by relative path.
func extReadsServer(t *testing.T, reads []any, files map[string]string) *Server {
	t.Helper()
	srv := repoReadServer(t, nil)
	manifest, _ := json.Marshal(map[string]any{
		"id": "acme-rules", "tools": []string{"repo.list", "repo.read"}, "reads": reads,
	})
	dir := filepath.Join(srv.PluginsDir, "acme-rules")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "plugin.json"), manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	grants := `{"tools":["repo.list","repo.read"]}`
	if err := os.WriteFile(filepath.Join(dir, "grants.json"), []byte(grants), 0o644); err != nil {
		t.Fatal(err)
	}
	for rel, body := range files {
		full := filepath.Join(srv.Registry.Root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		// Precondition: every fixture file is really there, so a refusal
		// below is the extension rule and not a missing file.
		if _, err := os.Stat(full); err != nil {
			t.Fatalf("fixture precondition: %s is missing: %v", rel, err)
		}
	}
	return srv
}

func listedPaths(t *testing.T, srv *Server, dir string) []string {
	t.Helper()
	args, _ := json.Marshal(map[string]string{"dir": dir})
	result, err := srv.hostRepoList("acme-rules", args)
	if err != nil {
		t.Fatalf("hostRepoList(%q): %v", dir, err)
	}
	raw, _ := json.Marshal(result)
	var out struct {
		Files []repoReadEntry `json:"files"`
	}
	_ = json.Unmarshal(raw, &out)
	paths := []string{}
	for _, f := range out.Files {
		paths = append(paths, f.Path)
	}
	return paths
}

// The object form lists and reads the declared extension.
// Mutation: pass []string{".md"} instead of exts to ListRepoFilesExts in
// hostRepoList → red (the .dmn file is not listed).
func TestTheObjectFormOfReadsAllowsTheDeclaredExtension(t *testing.T) {
	srv := extReadsServer(t,
		[]any{map[string]any{"dir": "rules", "ext": []string{".dmn"}}},
		map[string]string{"rules/pricing.dmn": "<definitions/>", "rules/notes.md": "# n"})

	got := listedPaths(t, srv, "rules")
	if len(got) != 1 || got[0] != "pricing.dmn" {
		t.Fatalf("repo.list = %v, want only pricing.dmn", got)
	}
	args, _ := json.Marshal(map[string]string{"dir": "rules", "path": "pricing.dmn"})
	res, err := srv.hostRepoRead("acme-rules", args)
	if err != nil {
		t.Fatalf("repo.read of a declared .dmn file: %v", err)
	}
	if body := res.(map[string]any)["body"]; body != "<definitions/>" {
		t.Errorf("repo.read body = %q", body)
	}
}

// The plain-string form keeps meaning .md only.
// Mutation: make Exts() return []string{".dmn"} for the string form → red.
func TestTheStringFormOfReadsStillAllowsMarkdownOnly(t *testing.T) {
	srv := extReadsServer(t, []any{"rules"},
		map[string]string{"rules/pricing.dmn": "<definitions/>", "rules/0001-notes.md": "# n"})

	got := listedPaths(t, srv, "rules")
	if len(got) != 1 || got[0] != "0001-notes.md" {
		t.Fatalf("repo.list = %v, want only the .md file", got)
	}
	args, _ := json.Marshal(map[string]string{"dir": "rules", "path": "pricing.dmn"})
	if res, err := srv.hostRepoRead("acme-rules", args); err == nil {
		t.Fatalf("repo.read of .dmn under the string form was allowed: %v", res)
	}
}

// An extension the entry does not list is refused: not listed, not readable.
// Mutation: in ReadRepoFileExts replace the membership loop with
// `return ReadRepoFile(dir, rel, got)` → red (b.xml and c.md are read).
func TestAnExtensionTheEntryDoesNotListIsRefused(t *testing.T) {
	srv := extReadsServer(t,
		[]any{map[string]any{"dir": "rules", "ext": []string{".dmn"}}},
		map[string]string{"rules/a.dmn": "<d/>", "rules/b.xml": "<x/>", "rules/c.md": "# c"})

	if got := listedPaths(t, srv, "rules"); len(got) != 1 || got[0] != "a.dmn" {
		t.Fatalf("repo.list = %v, want only a.dmn", got)
	}
	for _, name := range []string{"b.xml", "c.md"} {
		args, _ := json.Marshal(map[string]string{"dir": "rules", "path": name})
		if res, err := srv.hostRepoRead("acme-rules", args); err == nil {
			t.Errorf("repo.read of %s was allowed: %v", name, res)
		}
	}
}

// An extension declared for one directory gives nothing in another.
// Mutation: delete the `if d.Dir != dir { continue }` guard in ReadExtsFor →
// red (the second directory is then answered with the first one's extension).
func TestAnExtensionOnAnUndeclaredDirectoryIsRefused(t *testing.T) {
	srv := extReadsServer(t,
		[]any{map[string]any{"dir": "rules", "ext": []string{".dmn"}}},
		map[string]string{"rules/a.dmn": "<d/>", "other/b.dmn": "<d/>"})

	args, _ := json.Marshal(map[string]string{"dir": "other"})
	if res, err := srv.hostRepoList("acme-rules", args); err == nil {
		t.Fatalf("repo.list of an undeclared directory was answered: %v", res)
	}
	args, _ = json.Marshal(map[string]string{"dir": "other", "path": "b.dmn"})
	if res, err := srv.hostRepoRead("acme-rules", args); err == nil {
		t.Fatalf("repo.read in an undeclared directory was answered: %v", res)
	}
}

// A plugin.json that changed on disk after install can carry an extension
// the schema would have refused; the call refuses it again.
// Mutation: make ValidReadExt return true in ReadExtsFor's check → red.
func TestAnExtensionOutsideTheGrammarOnDiskIsRefusedAtTheCall(t *testing.T) {
	for _, ext := range []string{".env", ".pem", "dmn", ".DMN", ".dm.n"} {
		srv := extReadsServer(t,
			[]any{map[string]any{"dir": "rules", "ext": []string{ext}}},
			map[string]string{"rules/a" + ext: "secret"})
		args, _ := json.Marshal(map[string]string{"dir": "rules"})
		if res, err := srv.hostRepoList("acme-rules", args); err == nil {
			t.Errorf("repo.list answered for the declared extension %q: %v", ext, res)
		}
	}
}

// The route a plugin really takes, with the object form.
// Mutation: delete the `"repo.read": (*Server).hostRepoRead,` line from
// hostTools in plugincall.go → red.
func TestThePluginCallRouteServesTheObjectFormOfReads(t *testing.T) {
	srv := extReadsServer(t,
		[]any{map[string]any{"dir": "rules", "ext": []string{".dmn"}}},
		map[string]string{"rules/a.dmn": "<d/>"})
	body := `{"plugin":"acme-rules","tool":"repo.read","args":{"dir":"rules","path":"a.dmn"}}`
	req := loopbackRequest(http.MethodPost, PluginCallPath, strings.NewReader(body))
	authorizePluginRequest(t, srv, "acme-rules", req)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	var out map[string]json.RawMessage
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("the response is not JSON (%d): %v", rec.Code, err)
	}
	var read struct {
		Body string `json:"body"`
	}
	if err := json.Unmarshal(out["result"], &read); err != nil || read.Body != "<d/>" {
		t.Fatalf("repo.read through the route = %s (denied %s, error %s)", out["result"], out["denied"], out["error"])
	}
}

func TestADRConfiguredDirectory(t *testing.T) {
	srv := repoReadServer(t, map[string]string{"0001-old.md": sampleAdrBody})
	root := srv.Registry.Root
	if err := os.WriteFile(filepath.Join(root, facet.ConfigName), []byte("adr:\n  directory: architecture/decisions\n"), 0644); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(root, "architecture", "decisions")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "0002-new.md"), []byte(sampleAdrBody), 0644); err != nil {
		t.Fatal(err)
	}
	result, err := srv.hostRepoList("adr", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	out := result.(map[string]any)
	files := out["files"].([]repoReadEntry)
	if out["dir"] != "architecture/decisions" || len(files) != 1 || files[0].Path != "0002-new.md" {
		t.Fatalf("unexpected list: %+v", out)
	}
	body, err := srv.hostRepoRead("adr", json.RawMessage(`{"dir":"architecture/decisions","path":"0002-new.md"}`))
	if err != nil || body.(map[string]any)["body"] != sampleAdrBody {
		t.Fatalf("read: %v, %v", body, err)
	}
	for _, args := range []string{`{"dir":"docs/adr"}`, `{"dir":"docs"}`} {
		if _, err := srv.hostRepoList("adr", json.RawMessage(args)); err == nil {
			t.Fatalf("accepted %s", args)
		}
	}
	if _, err := srv.hostRepoRead("adr", json.RawMessage(`{"dir":"docs/adr","path":"0001-old.md"}`)); err == nil {
		t.Fatal("old scope readable")
	}
}

func TestADRConfiguredDirectoryRejectsExternalSymlink(t *testing.T) {
	srv := repoReadServer(t, nil)
	if err := os.WriteFile(filepath.Join(srv.Registry.Root, facet.ConfigName), []byte("adr:\n  directory: decisions\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), filepath.Join(srv.Registry.Root, "decisions")); err != nil {
		t.Fatal(err)
	}
	if _, err := srv.hostRepoList("adr", json.RawMessage(`{}`)); err == nil {
		t.Fatal("external symlink accepted")
	}
}
