package wiki

import (
	"path/filepath"

	"github.com/facet-framework/core/registry"
)

// Register connects wiki documents and prose to registry checks.
func Register() {
	facet.RegisterProductDocument(facet.ProductDocument{Path: WikiConfigPath, Schema: SchemaName})
	facet.RegisterProseSource(pagesSaying)
}

func pagesSaying(reg facet.Registry, term string) []string {
	wiki, err := LoadWiki(WikiDir(reg))
	if err != nil {
		return nil
	}
	var paths []string
	target := []string{term}
	for _, page := range wiki.Pages {
		if len(facet.FindTerms(page.Body, target)) > 0 || len(facet.FindTerms(page.Front.Summary, target)) > 0 {
			paths = append(paths, reg.Rel(filepath.Join(WikiDir(reg), page.Path)))
		}
	}
	return paths
}
