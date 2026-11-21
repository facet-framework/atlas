package wiki

import (
	"os"
	"path/filepath"

	"github.com/facet-framework/core/registry"
)

// WikiCorpus is a project's wiki as the reader receives it.
//
// The pages ship unparsed, for the reason the records do: the reader carries
// its own front-matter reader and its own model, and building a second one here
// would give the project two answers to what a page says. What the host does
// compute is the address of each page — because the keyword-and-colon form is
// what keeps a two-slash wiki path from being read as a record id, and that
// rule belongs in one place rather than in both halves.
type WikiCorpus struct {
	// Initialization names a real indexed Wiki checkout whose Git marker is absent.
	Initialization *WikiInitialization `json:"initialization,omitempty"`
	// GitError preserves failure to read a present Git marker.
	GitError string `json:"gitError,omitempty"`
	// Dir is where the wiki lives, relative to the repository root, so a
	// reader can name the file somebody has to open.
	Dir string `json:"dir"`
	// Config is wiki.yaml verbatim, empty when the project writes none. Empty
	// means the project declares no areas and no categories, which a reader
	// must render as "nothing declared" rather than as "no areas exist": every
	// folder is then an undeclared area and every page is still shown.
	//
	// Shipped even when it will not parse. A reader that can show the broken
	// file is a reader that can say what is wrong with it; withholding it would
	// leave "wiki.yaml could not be read" with nothing behind it.
	Config string `json:"config,omitempty"`
	// Pages are the page bodies, keyed by their path under the wiki dir.
	Pages map[string]string `json:"pages"`
	// Addresses is each page path's wiki address. A map beside Pages rather
	// than a field inside a parsed page, because the pages are deliberately
	// unparsed and this is the one derived value the host owns.
	Addresses map[string]string `json:"addresses"`
	// Unversioned reports that nothing is holding these pages: there is no git
	// repository, or git has been told to ignore the directory they are in.
	//
	// It ships with the corpus rather than being asked for when a surface
	// happens to need it, because the promise is that the reader keeps saying
	// so. A wiki that looks versioned and is not is the worse of the two
	// states, and a value that arrives only on the create path would say it
	// once, to the person who already knew.
	//
	// Measured by the host, like every other value here. The reader cannot
	// compute it: whether a path is ignored is a question .gitignore answers.
	Unversioned bool `json:"unversioned,omitempty"`
}

// BuildCorpus is the project's wiki as the reader receives it, nil when the
// project has written none.
//
// A pointer, and the one value where absent and empty had to be told apart in
// the type rather than by a length: a project with no wiki/ directory has not
// adopted a wiki, while a wiki holding no page has adopted one and written
// nothing in it yet. A reader handed an empty object for both would report the
// first as a wiki somebody emptied, which is the opposite of what happened.
func BuildCorpus(reg facet.Registry) *WikiCorpus {
	// Best-effort, like every optional part of the corpus, and with one
	// addition: the pages are read even when wiki.yaml will not parse, because an
	// unreadable declaration is a finding about one file rather than a reason
	// to withhold the prose beside it.
	availability := WikiAvailabilityState(reg)
	if initialization := availability.Initialization; initialization != nil {
		return &WikiCorpus{Dir: reg.Rel(WikiDir(reg)), Pages: map[string]string{}, Addresses: map[string]string{}, Initialization: initialization}
	} else if wiki, err := LoadWiki(WikiDir(reg)); err == nil && wiki.Present {
		return wikiCorpusAvailable(reg, wiki, availability)
	} else if err := availability.GitError; err != nil {
		return &WikiCorpus{Dir: reg.Rel(WikiDir(reg)), Pages: map[string]string{}, Addresses: map[string]string{}, GitError: err.Error()}
	}
	return nil
}

// wikiCorpus puts a loaded wiki into the shape the reader receives.
//
// The pages are re-read from disk rather than reassembled out of the header and
// body the loader split apart. Reassembling would mean choosing how to write the
// YAML back, and every such choice is a way for the bytes the reader gets to
// differ from the bytes in the file — which is precisely what "shipped
// unparsed" is supposed to rule out.
func wikiCorpus(reg facet.Registry, wiki *Wiki) *WikiCorpus {
	return wikiCorpusAvailable(reg, wiki, WikiAvailabilityState(reg))
}

func wikiCorpusAvailable(reg facet.Registry, wiki *Wiki, availability WikiAvailability) *WikiCorpus {
	gitError := ""
	if err := availability.GitError; err != nil {
		gitError = err.Error()
	}
	out := &WikiCorpus{
		GitError:  gitError,
		Dir:       reg.Rel(WikiDir(reg)),
		Pages:     map[string]string{},
		Addresses: map[string]string{},
		// The two git measurements and no more. Asking WikiGitState here
		// instead would additionally hunt for a forge token, which means
		// running 'gh auth token' as a subprocess on every corpus build — a
		// cost that is right once when an editor opens and wrong on a read.
		Unversioned: availability.Unversioned,
	}
	if data, err := os.ReadFile(WikiConfigPath(reg)); err == nil {
		out.Config = string(data)
	}
	for _, page := range wiki.Pages {
		data, err := os.ReadFile(filepath.Join(wiki.Dir, filepath.FromSlash(page.Path)))
		if err != nil {
			// A page that vanished between the walk and the read is a page the
			// reader simply does not get. Abandoning the corpus over one file
			// would cost every other panel.
			continue
		}
		out.Pages[page.Path] = string(data)
		out.Addresses[page.Path] = page.Address()
	}
	return out
}
