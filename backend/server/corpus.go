package server

import (
	"github.com/facet-framework/core/corpus"
	"github.com/facet-framework/core/registry"
)

// The HTTP reader and CLI snapshots share one corpus model and builder.
// Aliases preserve the reader package's existing API while serialization and
// source scanning remain independent of HTTP and embedded browser assets.
type (
	Corpus        = corpus.Corpus
	GlossaryGroup = corpus.GlossaryGroup
	Scan          = corpus.Scan
	ScannedFile   = corpus.ScannedFile
	Anchor        = corpus.Anchor
	Orphan        = corpus.Orphan
	Status        = corpus.Status
	Report        = corpus.Report
)

// Build reads the registry using the shared snapshot builder.
func Build(reg facet.Registry, report Report) (*Corpus, error) {
	return corpus.Build(reg, report)
}
