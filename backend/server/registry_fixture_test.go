// @facet-ignore-file
package server

import (
	"github.com/facet-framework/core/registry"
	"path/filepath"
	"testing"
)

func registryProject(t *testing.T) facet.Registry {
	t.Helper()
	root := t.TempDir()
	mustWriteCorpus(t, filepath.Join(root, "docs/facets/features/logistics/booking/release.yaml"),
		`schema_version: "0.1"
id: logistics/booking/release
lifecycle: active
intent:
  summary: |
    Releases a booking.
contract:
  scenarios:
    - id: release-marks-the-booking
      statement: |
        Given a booking
        When it is released
        Then it is marked released
lineage:
  owner:
    team: logistics
  created_at: "2026-09-16"
`)
	mustWriteCorpus(t, filepath.Join(root, "src/release.ts"),
		"// @facet: logistics/booking/release\n// @facet-role: primary\nexport function release() {}\n")

	return facet.Open(root)
}

func buildCorpus(t *testing.T, reg facet.Registry) *Corpus {
	t.Helper()
	corpus, err := Build(reg, nil)
	if err != nil {
		t.Fatal(err)
	}
	return corpus
}
