package bundledsums_test

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/facet-framework/atlas/backend/internal/bundledsums"
)

// The checksum consumer must register every binary measured by the build.
func TestMeasuredSidecarsMatchChecksumCatalogue(t *testing.T) {
	compositionRoot, producerRoot, _ := bundledsumsSourceModules(t)
	raw, err := os.ReadFile(filepath.Join(compositionRoot, "sidecars.list"))
	if err != nil {
		t.Fatal(err)
	}
	var listed []string
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 {
			t.Fatalf("backend/sidecars.list: %q is not '<bin> <package>'", line)
		}
		if _, err := os.Stat(filepath.Join(producerRoot, fields[1])); err != nil {
			t.Errorf("backend/sidecars.list names %s, which does not exist", fields[1])
		}
		listed = append(listed, fields[0])
	}
	// Precondition: the list is not empty, or every check below is vacuous.
	if len(listed) == 0 {
		t.Fatalf("backend/sidecars.list names %d sidecars", len(listed))
	}

	bins := append([]string(nil), bundledsums.Bins...)
	sort.Strings(bins)
	sort.Strings(listed)
	if strings.Join(bins, ",") != strings.Join(listed, ",") {
		t.Errorf("bundledsums.Bins = %v, backend/sidecars.list = %v", bins, listed)
	}
}
