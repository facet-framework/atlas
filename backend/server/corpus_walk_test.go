// The fixtures below carry @facet: tags for features that exist only inside a
// temporary directory, so this file opts itself out of anchor scanning:
// @facet-ignore-file

package server

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"github.com/facet-framework/core/registry"
)

func countingGit(t *testing.T) func() int {
	t.Helper()

	if runtime.GOOS == "windows" {
		t.Skip("the git shim is a shell script")
	}
	realGit, err := exec.LookPath("git")
	if err != nil {
		t.Skipf("git is unavailable here: %v", err)
	}

	dir := t.TempDir()
	counter := filepath.Join(dir, "ls-files.count")
	shim := "#!/bin/sh\n" +
		"for arg in \"$@\"; do\n" +
		"  if [ \"$arg\" = \"ls-files\" ]; then printf 'x' >> " + strconv.Quote(counter) + "; fi\n" +
		"done\n" +
		"exec " + strconv.Quote(realGit) + " \"$@\"\n"
	if err := os.WriteFile(filepath.Join(dir, "git"), []byte(shim), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	// Proves the shim is the git that will actually be run. Without this, a
	// PATH that resolved elsewhere would leave every count at zero and the
	// assertion below would pass by measuring nothing.
	if out, err := exec.Command("git", "ls-files", "--error-unmatch", "definitely-not-a-file").CombinedOutput(); err == nil {
		t.Fatalf("the probe was expected to fail against a missing file, got %s", out)
	}
	probe, err := os.ReadFile(counter)
	if err != nil || len(probe) != 1 {
		t.Fatalf("the shim did not record the probe call (count=%d, err=%v) — PATH is not pointing at it", len(probe), err)
	}
	if err := os.Remove(counter); err != nil {
		t.Fatal(err)
	}

	return func() int {
		data, err := os.ReadFile(counter)
		if os.IsNotExist(err) {
			return 0
		}
		if err != nil {
			t.Fatal(err)
		}
		return len(data)
	}
}

func TestBuildWalksTheTreeOnce(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	reg := gitProject(t, map[string]string{
		".facetrc.yaml": "schema_version: \"0.1\"\nrecords: docs/facets\n",
		"docs/facets/features/tasks/create/quick-add.yaml": quickAdd,
		"src/quick_add.ts": "// @facet: tasks/create/quick-add\n// @facet-role: primary\nexport function quickAdd() {}\n",
		"src/util.ts":      "export const helper = 1;\n",
	})
	walks := countingGit(t)

	corpus, err := Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	// One root, so one walk: the registry declares no `sources:`.
	if n := walks(); n != 1 {
		t.Fatalf("the tree was walked %d times, want 1 — a second walk doubles the scan and reports no progress while it runs", n)
	}
	// The calibration must come from that one walk rather than be absent: a
	// corpus that simply stopped calibrating would also walk once, and would
	// pass an assertion that only counted.
	if corpus.Calibration == nil {
		t.Fatal("want a calibration built from the walk that already happened")
	}
	if corpus.Calibration.AnchoredFiles != len(corpus.Scan.AnchoredFiles) {
		t.Fatalf("calibration counted %d anchored files, the scan %d — they came from different walks",
			corpus.Calibration.AnchoredFiles, len(corpus.Scan.AnchoredFiles))
	}
}

func TestBuildFindsAnchorsInDotDirectoriesLikeTheScannerDoes(t *testing.T) {
	for _, rel := range []string{
		".github/workflows/release.yml",
		".claude/hooks/probe.sh",
		"src/.hidden/probe.ts",
	} {
		t.Run(rel, func(t *testing.T) {
			reg := project(t, map[string]string{
				"docs/facets/features/tasks/create/quick-add.yaml": quickAdd,
				rel: "# @facet: tasks/create/quick-add\n# @facet-role: primary\n",
			})

			corpus, err := Build(reg, nil)
			if err != nil {
				t.Fatal(err)
			}
			if len(corpus.Scan.Anchors["tasks/create/quick-add"]) != 1 {
				t.Fatalf("the reader must find the anchor under %s, as facet lint does; got %+v",
					rel, corpus.Scan.Anchors["tasks/create/quick-add"])
			}

			// And the same answer really is the scanner's answer, rather than
			// two walks that happen to agree on this one fixture.
			anchors, err := facet.ScanAnchors(reg.Root, facet.ScanOptions{})
			if err != nil {
				t.Fatal(err)
			}
			if len(anchors) != len(corpus.Scan.Anchors["tasks/create/quick-add"]) {
				t.Fatalf("the scanner found %d anchors and the reader %d under %s",
					len(anchors), len(corpus.Scan.Anchors["tasks/create/quick-add"]), rel)
			}
		})
	}
}

func TestBuildNeverReadsVCSMetadataDirectories(t *testing.T) {
	reg := project(t, map[string]string{
		"docs/facets/features/tasks/create/quick-add.yaml": quickAdd,
		"src/quick_add.ts":             "// @facet: tasks/create/quick-add\n// @facet-role: primary\n",
		".git/hooks/pre-commit.sample": "# @facet: bogus/from/dotgit\n",
		".svn/entries":                 "@facet: bogus/from/dotsvn\n",
		".hg/store/00changelog.i":      "@facet: bogus/from/dothg\n",
	})

	corpus, err := Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	for id := range corpus.Scan.Anchors {
		if strings.HasPrefix(id, "bogus/") {
			t.Fatalf("an anchor was read out of a VCS metadata directory: %s", id)
		}
	}
	for _, o := range corpus.Scan.OrphanAnchors {
		if strings.HasPrefix(o.ID, "bogus/") {
			t.Fatalf("an anchor was read out of a VCS metadata directory: %+v", o)
		}
	}
	for _, f := range append(append([]ScannedFile{}, corpus.Scan.AnchoredFiles...), corpus.Scan.UnanchoredFiles...) {
		for _, vcs := range []string{".git/", ".svn/", ".hg/"} {
			if strings.HasPrefix(filepath.ToSlash(f.Path), vcs) {
				t.Fatalf("a file inside %s was opened and counted: %s", vcs, f.Path)
			}
		}
	}
}
