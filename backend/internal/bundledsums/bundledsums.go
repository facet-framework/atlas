// Package bundledsums embeds measured release sidecar checksums, one file per
// <bin>-<goos>-<goarch>.sha256. Only cmd/facet may import it and pass sums via
// facet.SetBundledSidecarSum: sidecars link internal/facet, and embedding their
// sums there would change the very bytes being hashed. Separate files prevent
// measuring one sidecar from changing another's expected sum.
// Dependency tests enforce that sidecars never link this package.
package bundledsums

import (
	"embed"
	"strings"
)

// Embed this source file so a clean contributor checkout can compile before
// release builds generate the ignored checksum files.
//
//go:embed *
var sums embed.FS

// Bins names every sidecar this package holds sums for. It must match
// backend/sidecars.list, the list every build path measures from;
// TestMeasuredSidecarsMatchChecksumCatalogue holds the two together.
var Bins = []string{"bpmn", "dmn", "confluence"}

// Sum returns this build's checksum for a sidecar and GOOS-GOARCH platform,
// such as linux-amd64. An empty result means unmeasured, never a wildcard;
// callers must preserve that result when registering checksums.
func Sum(bin, platform string) string {
	raw, err := sums.ReadFile(bin + "-" + platform + ".sha256")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}
