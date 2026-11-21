// The fixtures below carry @facet: tags for features that exist only inside a
// temporary directory, so this file opts itself out of anchor scanning:
// @facet-ignore-file

package server

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/facet-framework/core/registry"
)

func gitProject(t *testing.T, files map[string]string) facet.Registry {
	t.Helper()
	root := t.TempDir()
	for name, body := range files {
		path := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, args := range [][]string{
		{"init", "-q"},
		{"config", "user.email", "hello@facet-framework.com"},
		{"config", "user.name", "Test"},
		{"add", "-A"},
		{"commit", "-q", "-m", "first Revision"},
	} {
		cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Skipf("git is unavailable here: %v (%s)", err, out)
		}
	}
	return facet.Open(root)
}

// Corpus enumeration respects directories excluded through .git/info/exclude.
func TestBuildSkipsFilesExcludedOnlyByGitInfoExclude(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	reg := gitProject(t, map[string]string{
		".facetrc.yaml": "schema_version: \"0.1\"\nrecords: docs/facets\n",
		"docs/facets/features/tasks/create/quick-add.yaml": quickAdd,
		"src/quick_add.ts": "// @facet: tasks/create/quick-add\n// @facet-role: primary\nexport function quickAdd() {}\n",
	})

	if err := os.MkdirAll(filepath.Join(reg.Root, "vendor"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(reg.Root, "vendor/bundle.js"), []byte("// @facet: tasks/create/quick-add\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	corpus, err := Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(corpus.Scan.Anchors["tasks/create/quick-add"]) != 2 {
		t.Fatalf("without an exclude entry both anchors are found, got %d", len(corpus.Scan.Anchors["tasks/create/quick-add"]))
	}

	if err := os.WriteFile(filepath.Join(reg.Root, ".git/info/exclude"), []byte("vendor/\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	corpus, err = Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	anchors := corpus.Scan.Anchors["tasks/create/quick-add"]
	if len(anchors) != 1 {
		t.Fatalf(".git/info/exclude must exclude vendor/, got %d anchors", len(anchors))
	}
	if anchors[0].Path != "src/quick_add.ts" {
		t.Fatalf("the surviving anchor should be src/quick_add.ts, got %q", anchors[0].Path)
	}
}

// This is the .gitignore premise of ignore-rules-are-honoured, not the
// separate .git/info/exclude promise above. The file is deliberately untracked:
// GitRelevantFiles keeps tracked files even if a later rule matches them.
// Runnable mutation: in sourceFiles, set walker.IgnoreGitIgnore=true and
// useGit=false. The corpus still builds, but the excluded build output returns
// to the scanned-file and anchor lists and this test fails.
func TestBuildHonoursGitignoreForUntrackedBuildOutput(t *testing.T) {
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(t.TempDir(), "absent"))
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	reg := gitProject(t, map[string]string{
		".facetrc.yaml": "schema_version: \"0.1\"\nrecords: docs/facets\n",
		"docs/facets/features/tasks/create/quick-add.yaml": quickAdd,
		"src/quick_add.ts": "// @facet: tasks/create/quick-add\n// @facet-role: primary\nexport function quickAdd() {}\n",
	})
	output := filepath.Join(reg.Root, "build", "bundle.js")
	if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(output, []byte("// @facet: tasks/create/quick-add\n// @facet-role: primary\nexport function bundled() {}\n"), 0644); err != nil {
		t.Fatal(err)
	}
	isScanned := func(corpus *Corpus, path string) bool {
		for _, file := range append(append([]ScannedFile{}, corpus.Scan.AnchoredFiles...), corpus.Scan.UnanchoredFiles...) {
			if file.Path == path {
				return true
			}
		}
		return false
	}
	before, err := Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !isScanned(before, "build/bundle.js") {
		t.Fatal("fixture build output must be scanned before the ignore rule")
	}
	if len(before.Scan.Anchors["tasks/create/quick-add"]) != 2 {
		t.Fatalf("fixture must carry both source and build anchors: %#v", before.Scan.Anchors)
	}
	if out, err := exec.Command("git", "-C", reg.Root, "ls-files", "--", "build/bundle.js").Output(); err != nil || len(out) != 0 {
		t.Fatalf("build output must be untracked: %s, %v", out, err)
	}
	if err := os.WriteFile(filepath.Join(reg.Root, ".gitignore"), []byte("build/\n"), 0644); err != nil {
		t.Fatal(err)
	}
	after, err := Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if isScanned(after, "build/bundle.js") {
		t.Fatal(".gitignore build output is still listed as scanned")
	}
	if !isScanned(after, "src/quick_add.ts") {
		t.Fatal("the real source must remain scanned")
	}
	anchors := after.Scan.Anchors["tasks/create/quick-add"]
	if len(anchors) != 1 || anchors[0].Path != "src/quick_add.ts" {
		t.Fatalf("only the real source anchor should survive: %#v", anchors)
	}
}
