package wiki

import (
	"strings"

	"github.com/facet-framework/core/registry"
)

// Small helpers this package used while it lived inside internal/facet. They
// are copied rather than exported from Core because each is a one-line
// formatting rule, not a contract another package should rely on.

// knownIDs collects every record id of the given registries.
func knownIDs(registries []facet.Registry) map[string]bool {
	out := map[string]bool{}
	for _, reg := range registries {
		for _, cat := range facet.Categories {
			recs, err := reg.LoadCategory(cat)
			if err != nil {
				continue
			}
			for _, rec := range recs {
				out[rec.ID] = true
			}
		}
	}
	return out
}

// nameList writes a declared list for a hint, naming its absence.
func nameList(names []string) string {
	if len(names) == 0 {
		return "(none declared)"
	}
	return strings.Join(names, ", ")
}

// shellQuote quotes one value for a POSIX shell command line.
func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}
