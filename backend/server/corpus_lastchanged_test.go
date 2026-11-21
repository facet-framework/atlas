// The fixtures below carry @facet: tags for features that exist only inside a
// temporary directory, so this file opts itself out of anchor scanning:
// @facet-ignore-file
package server

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// commitAll turns a project directory into a repository with one commit on a
// fixed day, so the corpus has a history to read.
func commitAll(t *testing.T, root, day string) {
	t.Helper()
	stamp := day + "T12:00:00+00:00"
	for _, args := range [][]string{
		{"init", "--quiet", "--initial-branch=main"},
		{"add", "-A"},
		{"commit", "-q", "-m", "init"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_DATE="+stamp, "GIT_COMMITTER_DATE="+stamp,
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=hello@facet-framework.com",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=hello@facet-framework.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
		}
	}
}

// The reader sorts what records say by when they last changed, and it can
// only do that if the initial corpus carries the dates. Checked on the
// corpus as it is serialised to the browser, not on facet.LastChanged.
func TestTheCorpusCarriesEachRecordAndAnchoredFilesLastChange(t *testing.T) {
	reg := project(t, map[string]string{
		"docs/facets/features/tasks/create/quick-add.yaml": quickAdd,
		"src/quick_add.ts": "// @facet: tasks/create/quick-add\nexport function quickAdd() {}\n",
		"src/util.ts":      "export function util() {}\n",
	})
	commitAll(t, reg.Root, "2026-07-04")

	corpus, err := Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(corpus.Scan)
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		LastChanged map[string]string `json:"lastChanged"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}

	for _, rel := range []string{"docs/facets/features/tasks/create/quick-add.yaml", "src/quick_add.ts"} {
		if got := wire.LastChanged[rel]; got != "2026-07-04" {
			t.Errorf("lastChanged[%q] = %q, want 2026-07-04 (all: %v)", rel, got, wire.LastChanged)
		}
	}
	// An unanchored file is not something the reader names, so it is not sent.
	if _, sent := wire.LastChanged["src/util.ts"]; sent {
		t.Errorf("an unanchored file should not be in lastChanged: %v", wire.LastChanged)
	}
}

// Without history the field is absent on the wire, not an empty map — an
// empty map would read as "measured, and nothing changed".
func TestWithoutHistoryTheCorpusSendsNoLastChanged(t *testing.T) {
	reg := project(t, map[string]string{
		"docs/facets/features/tasks/create/quick-add.yaml": quickAdd,
		"src/quick_add.ts": "// @facet: tasks/create/quick-add\nexport function quickAdd() {}\n",
	})
	// Prevent discovery of an enclosing checkout even when TMPDIR is inside it.
	t.Setenv("GIT_CEILING_DIRECTORIES", filepath.Dir(reg.Root))
	// Precondition: this really is not a repository.
	if err := exec.Command("git", "-C", reg.Root, "rev-parse", "--git-dir").Run(); err == nil {
		t.Fatal("isolated no-history fixture unexpectedly resolved a git repository")
	}

	corpus, err := Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(corpus.Scan)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"lastChanged"`) {
		t.Fatalf("lastChanged must be absent without history, got %s", raw)
	}
}
