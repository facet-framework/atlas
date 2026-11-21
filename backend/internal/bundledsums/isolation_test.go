package bundledsums_test

import (
	"os/exec"
	"strings"
	"testing"
)

// Sidecars must not link the checksums recording their own compiled bytes.
// The composition executable must link them so it can initialize verification.
// Query the actual import graphs: a transitive import is just as significant
// as a direct import, and tests themselves are not part of the shipped graph.
func TestOnlyCmdFacetLinksBundledsums(t *testing.T) {
	compositionRoot, producerRoot, compositionModule := bundledsumsSourceModules(t)
	pkg := compositionModule + "/internal/bundledsums"
	dependencies := func(root, target string) map[string]bool {
		t.Helper()
		cmd := exec.Command("go", "list", "-deps", target)
		cmd.Dir = root
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("go list -deps %s from %s: %v\n%s", target, root, err, out)
		}
		deps := make(map[string]bool)
		for _, dep := range strings.Fields(string(out)) {
			deps[dep] = true
		}
		return deps
	}
	for _, target := range []string{
		"./plugins/bpmn/sidecar/bpmn",
		"./plugins/dmn/sidecar/dmn",
		"./plugins/wiki/sidecar/confluence",
	} {
		if dependencies(producerRoot, target)[pkg] {
			t.Errorf("sidecar %s links %q, which records its own hash", target, pkg)
		}
	}
	if !dependencies(compositionRoot, "./cmd/facet")[pkg] {
		t.Errorf("cmd/facet does not link %q; measured checksums would never reach verification", pkg)
	}
}
