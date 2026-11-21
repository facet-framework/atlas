// Fixtures below anchor features that exist only in a temporary directory, so
// this file opts itself out of anchor scanning: @facet-ignore-file

package server

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/facet-framework/core/registry"
)

func gitCorpusProject(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, body := range files {
		mustWriteCorpus(t, filepath.Join(root, filepath.FromSlash(rel)), body)
	}
	for _, args := range [][]string{
		{"init", "-q"},
		{"config", "user.email", "hello@facet-framework.com"},
		{"config", "user.name", "t"},
		{"add", "-A"},
		{"commit", "-q", "-m", "first version"},
	} {
		if out, err := exec.Command("git", append([]string{"-C", root}, args...)...).CombinedOutput(); err != nil {
			t.Skipf("git is unavailable here: %v (%s)", err, out)
		}
	}
	return root
}

// Atlas receives the same affected records the CLI prints, including a record
// whose only implementation file is absent — no current anchor names it, so
// before this the reader could not show it at all.
func TestTheReaderAndTheCLINameTheSameLostReferences(t *testing.T) {
	root := gitCorpusProject(t, map[string]string{
		"docs/facets/features/tasks/create/quick-add.yaml": "schema_version: \"0.1\"\nid: tasks/create/quick-add\nlifecycle: active\n",
		"docs/facets/features/lists/core/store.yaml":       "schema_version: \"0.1\"\nid: lists/core/store\nlifecycle: active\n",
		"src/quick add.ts": "// @facet: tasks/create/quick-add\n// @facet-role: primary\nexport function quickAdd() {}\n",
		"src/store.ts":     "// @facet: lists/core/store\n// @facet-role: primary\nexport const s = 1;\n",
	})
	if err := os.Remove(filepath.Join(root, "src/quick add.ts")); err != nil {
		t.Fatal(err)
	}
	mustWriteCorpus(t, filepath.Join(root, "src/store.ts"), "export const s = 1;\n")

	reg := facet.Open(root)
	corpus, err := Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	cli, err := facet.ComputeDrift(root, []facet.Registry{reg}, "")
	if err != nil {
		t.Fatal(err)
	}

	if len(cli.ReferenceChanges) != 2 {
		t.Fatalf("precondition: the CLI must see both losses, got %+v", cli.ReferenceChanges)
	}
	if !reflect.DeepEqual(corpus.Scan.ReferenceChanges, cli.ReferenceChanges) {
		t.Errorf("reader and CLI disagree:\nreader %+v\ncli    %+v", corpus.Scan.ReferenceChanges, cli.ReferenceChanges)
	}
	if corpus.Scan.DriftBaseline.Status != facet.BaselineOK || corpus.Scan.DriftBaseline.Kind != facet.BaselineHead {
		t.Errorf("the reader must be told what it was compared against: %+v", corpus.Scan.DriftBaseline)
	}

	// On the wire, under the names the reader reads.
	wire, err := json.Marshal(corpus.Scan)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"referenceChanges":[`, `"driftBaseline":{`, `"path":"src/quick add.ts"`} {
		if !strings.Contains(string(wire), key) {
			t.Errorf("the scan JSON lacks %s:\n%s", key, wire)
		}
	}
}

// Outside git the reader is told so, rather than receiving an empty list that
// reads as "nothing drifted".
func TestTheReaderIsToldWhenNothingCouldBeCompared(t *testing.T) {
	root := t.TempDir()
	mustWriteCorpus(t, filepath.Join(root, "docs/facets/features/tasks/create/quick-add.yaml"),
		"schema_version: \"0.1\"\nid: tasks/create/quick-add\nlifecycle: active\n")

	corpus, err := Build(facet.Open(root), nil)
	if err != nil {
		t.Fatal(err)
	}

	if corpus.Scan.DriftBaseline.Status != facet.BaselineNoRepository {
		t.Errorf("want no-repository, got %+v", corpus.Scan.DriftBaseline)
	}
	if corpus.Scan.ReferenceChanges == nil || corpus.Scan.Drift == nil {
		t.Error("the lists must still arrive as lists, not null")
	}
}

func TestReaderUsesDeclaredSourceCloneChangeSets(t *testing.T) {
	root := gitCorpusProject(t, map[string]string{
		".gitignore":    "platform/\n",
		".facetrc.yaml": "sources: [platform/backend]\n",
		"docs/facets/features/tasks/create/quick-add.yaml": "schema_version: \"0.1\"\nid: tasks/create/quick-add\nlifecycle: active\n",
	})
	clone := gitCorpusProject(t, map[string]string{"src/pay.go": "// @facet: tasks/create/quick-add\npackage pay\nfunc Pay() {}\n"})
	target := filepath.Join(root, "platform/backend")
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(clone, target); err != nil {
		t.Fatal(err)
	}
	if _, err := facet.AcceptReview(target, nil, "behavior-unchanged"); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(target, "src/pay.go")); err != nil {
		t.Fatal(err)
	}
	reg := facet.Open(root)
	corpus, err := Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	cli, err := facet.ComputeDrift(root, []facet.Registry{reg}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(cli.ReferenceChanges) != 1 || cli.ReferenceChanges[0].Path != "platform/backend/src/pay.go" {
		t.Fatalf("fixture missing source deletion: %+v", cli)
	}
	if !reflect.DeepEqual(corpus.Scan.ReferenceChanges, cli.ReferenceChanges) || !reflect.DeepEqual(corpus.Scan.DriftRepositories, cli.Repositories) {
		t.Fatalf("reader lost clone changes or baselines: %+v vs %+v", corpus.Scan, cli)
	}
	if err := os.RemoveAll(filepath.Join(root, ".git")); err != nil {
		t.Fatal(err)
	}
	mustWriteCorpus(t, filepath.Join(target, "src/pay.go"), "// @facet: tasks/create/quick-add\npackage pay\nfunc Pay() { println(1) }\n")
	corpus, err = Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(corpus.Scan.Drift) != 1 || corpus.Scan.Drift[0].Path != "platform/backend/src/pay.go" {
		t.Fatalf("non-git workspace lost clone drift: %+v", corpus.Scan.Drift)
	}
	if len(corpus.Scan.DriftRepositories) != 1 || corpus.Scan.DriftRepositories[0].Path != "platform/backend" || corpus.Scan.DriftRepositories[0].Baseline.Kind != facet.BaselineAccepted {
		t.Fatalf("non-git workspace lost source baseline: %+v", corpus.Scan.DriftRepositories)
	}
}
