package wiki

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/facet-framework/core/registry"
)

// ErrWikiSourceUnsupported is a direction a source does not do.
//
// Returned rather than silently succeeding, because an empty successful run and
// a direction that does not exist look identical to a caller, and only one of
// them means anything.
var ErrWikiSourceUnsupported = errors.New("this source does not support that direction")

// WikiMirrorStateName is where the mirror keeps what it last pushed.
//
// Beside the pages, never inside them. A marker in each page's header would
// make every mirror run rewrite every page — a commit per run and a diff nobody
// reads — and it would put a machine's bookkeeping into a file a person edits.
// This is the manifest pattern reused rather than reinvented: a lockfile, not
// an attestation, keyed on content digests rather than on timestamps, because a
// timestamp says when a file was touched and the question is whether it says
// something different.
const WikiMirrorStateName = ".mirror.json"

// WikiWriter accepts imported Markdown pages through the host's checked write
// path. Implementations enforce wiki path containment and filename grammar,
// and refuse YAML writes, before storing a page.
type WikiWriter interface {
	// Write puts one page at a path relative to the wiki directory, returning
	// the path it actually wrote or the refusal.
	Write(rel, body string) (string, error)
}

// WikiSource imports pages from an external system and optionally mirrors local
// pages back to it. Imports use WikiWriter and report conversion losses. Branch
// management, commits and pull requests remain the host's responsibility.
type WikiSource interface {
	// Name is what this source is called on a command line.
	Name() string
	// Detect reports whether a reference belongs to this source.
	Detect(ref string) bool
	// Import writes .md files through the writer and reports what was lost.
	//
	// The report is the deliverable rather than the page count: a source that
	// cannot say what it dropped is a source that drops things silently, and
	// the loss is discovered months later by whoever needed the missing macro.
	Import(ctx context.Context, ref string, into WikiWriter) (WikiImportReport, error)
	// Mirror pushes pages out again. Optional: a source that only imports
	// answers ErrWikiSourceUnsupported.
	//
	// It is handed the state so it can compare digests, and it records what it
	// pushed. It is not handed a merge algorithm, because there is none: the
	// policy is detect, refuse, report.
	Mirror(ctx context.Context, pages []WikiMirrorPage, state *WikiMirrorState) (WikiMirrorReport, error)
}

// WikiLoss is one thing an import could not carry across.
type WikiLoss struct {
	// Page is the page it was lost from, in the source's own naming.
	Page string `json:"page"`
	// What was lost — "macro", "comments", "permissions", "versions".
	What string `json:"what"`
	// Why, in a sentence somebody reading the pull request can act on.
	Why string `json:"why"`
}

// WikiImportedPage is one page an import produced.
type WikiImportedPage struct {
	Path string `json:"path"`
	// RenamedFrom is the source's own name, when it had to be rewritten to fit
	// the address grammar. Empty when nothing was renamed.
	RenamedFrom string `json:"renamedFrom,omitempty"`
	// Aliases lists prior page addresses recorded by the importer so existing
	// external links can resolve to the imported page.
	Aliases []string `json:"aliases,omitempty"`
}

// WikiImportReport is what an import did and what it could not do.
type WikiImportReport struct {
	Source string             `json:"source"`
	Ref    string             `json:"ref"`
	Pages  []WikiImportedPage `json:"pages"`
	// Lost is what did not come across, per page. The list is the report.
	Lost []WikiLoss `json:"lost"`
	// Refused is what the write path would not accept — a path leaving the wiki
	// directory, or a file that is not a page. Reported rather than dropped, so
	// an import that quietly skipped half a space cannot look like a clean one.
	Refused []WikiLoss `json:"refused"`
}

// ConfluenceRepeatedImportWarning explains why importing the same pages again
// can overwrite local edits without establishing a synchronised connection.
const ConfluenceRepeatedImportWarning = "this import overwrites the local copy of these pages — " +
	"Confluence does not learn about edits made here, and 'imported' does not mean 'connected': " +
	"after an import the wiki is the origin, and the Confluence address in 'aliases' is an alternative address"

// WikiMirrorPage is one page offered to a mirror.
type WikiMirrorPage struct {
	Path    string `json:"path"`
	Address string `json:"address"`
	Title   string `json:"title"`
	// Body is the page's PROSE — what follows the header, never the header
	// itself.
	//
	// The field carries only prose rather than RenderWikiPage's whole-file
	// output. Keeping the header fence out prevents a source from accidentally
	// pushing 'title: …' and 'aliases: […]' into the far system as visible text
	// — CommonMark reads a leading '---' as a rule and the keys under it as a
	// setext heading, so it does not even look like a mistake on arrival. The
	// The field states what it holds so every source observes the same boundary.
	//
	// The header's facts are not lost: Title is here, Address is here, and what
	// a target system can honestly show of the rest is that target's decision.
	Body string `json:"body"`
	// Digest is the digest of the whole page file, header included.
	//
	// Deliberately not a digest of Body: the question it answers is "has this
	// page changed since we last pushed it", and a page whose category or tags
	// were edited has changed. Narrowing this too would make a header-only edit
	// invisible to the mirror.
	Digest string `json:"digest"`
	// Space is what the page's own 'mirror:' declares about where it belongs,
	// empty when it declares nothing.
	Space string `json:"space,omitempty"`
}

// WikiMirrorEntry is what was last pushed for one page.
type WikiMirrorEntry struct {
	// Digest is the page's content digest as it was pushed.
	Digest string `json:"digest"`
	// RemoteID is the far side's identifier, so a conflict can name both.
	RemoteID string `json:"remoteId"`
	// RemoteDigest is what the far side held immediately after the push. A
	// later run comparing this against what the far side holds now is how a
	// change over there is detected without a second merge algorithm.
	RemoteDigest string `json:"remoteDigest"`
}

// WikiMirrorState is the mirror's record of what it last pushed.
type WikiMirrorState struct {
	// Target names which system this state is about, so two targets do not
	// silently share one file's worth of digests.
	Target  string                     `json:"target"`
	Entries map[string]WikiMirrorEntry `json:"entries"`
	// DisplacedTarget is the target a state file on disk named, when it named
	// another one and this state was therefore handed back empty.
	//
	// Not serialised: it is a fact about this load, not about the file. It
	// exists because blanking a foreign target is right for reading — foreign
	// digests would make every page look unchanged — and yet on its own leaves
	// a source unable to tell a second target from a first run, so a save
	// would replace the first target's digests with nothing anywhere saying
	// so. A source that means to refuse rather than forget needs this one fact.
	DisplacedTarget string `json:"-"`
}

// Entry returns what was last pushed for a page.
func (s *WikiMirrorState) Entry(path string) (WikiMirrorEntry, bool) {
	if s == nil || s.Entries == nil {
		return WikiMirrorEntry{}, false
	}
	entry, ok := s.Entries[path]
	return entry, ok
}

// Record stores what was just pushed for a page.
func (s *WikiMirrorState) Record(path string, entry WikiMirrorEntry) {
	if s.Entries == nil {
		s.Entries = map[string]WikiMirrorEntry{}
	}
	s.Entries[path] = entry
}

// WikiMirrorConflict is a page that changed on the far side.
type WikiMirrorConflict struct {
	Page string `json:"page"`
	// RemoteID is the far side's own identifier, so a person can open both.
	RemoteID string `json:"remoteId"`
	Why      string `json:"why"`
}

// WikiMirrorReport is what a mirror run did.
type WikiMirrorReport struct {
	Target    string               `json:"target"`
	Pushed    []string             `json:"pushed"`
	Unchanged []string             `json:"unchanged"`
	Skipped   []string             `json:"skipped"`
	Conflicts []WikiMirrorConflict `json:"conflicts"`
	// EmbedLosses are the live views a page was written around that the target
	// system cannot hold. Named per page and per component, never counted — the
	// same rule an import's macro losses follow, in the other direction. A page
	// can go out looking complete while the view it was built around did not,
	// and a report that only counted pushes would never say so.
	EmbedLosses []WikiLoss `json:"embedLosses,omitempty"`
}

// WikiReplacingWriter is a writer that can also say whether it replaced a page
// that was already there.
//
// Optional, and asked for by type assertion, so the narrow WikiWriter stays the
// interface a source has to satisfy. It exists because a source cannot see the
// filesystem — deliberately — and yet a repeated import has to be able to say
// that it overwrote somebody's local edits. Without this the only honest
// alternatives were to let the source stat files, which reopens the door the
// writer exists to narrow, or to say nothing, which is how "imported" comes to
// read as "connected".
type WikiReplacingWriter interface {
	WikiWriter
	// WriteReporting writes a page and reports whether one was already there.
	WriteReporting(rel, body string) (written string, replaced bool, err error)
}

// wikiDirWriter is the WikiWriter a real import gets: the write path, nothing
// else.
type wikiDirWriter struct {
	reg     facet.Registry
	wikiDir string
}

func (w wikiDirWriter) Write(rel, body string) (string, error) {
	return WriteWikiPage(w.reg, w.wikiDir, rel, body)
}

// WriteReporting writes and says whether it replaced.
//
// The check happens after the path is resolved, so a path the write path would
// refuse is refused here too rather than being stat'ed first — the refusal is
// still the write path's, and this method adds a fact about the write rather
// than a second opinion about the path.
func (w wikiDirWriter) WriteReporting(rel, body string) (string, bool, error) {
	abs, err := ResolveWikiPath(w.wikiDir, rel)
	if err != nil {
		return "", false, err
	}
	_, statErr := os.Stat(abs)
	replaced := statErr == nil
	written, err := WriteWikiPage(w.reg, w.wikiDir, rel, body)
	return written, replaced, err
}

// ImportWiki runs a source's import into a wiki directory.
//
// The wiki supplies the writer, so every file the source produces passes the
// same refusals every other write passes. A source that names a path outside
// the wiki gets the refusal in its report and writes nothing — which is how the
// widest door in the design stays the same width as the others.
func ImportWiki(ctx context.Context, reg facet.Registry, wikiDir string, src WikiSource, ref string) (WikiImportReport, error) {
	if err := os.MkdirAll(wikiDir, 0o755); err != nil {
		return WikiImportReport{}, err
	}
	report, err := src.Import(ctx, ref, wikiDirWriter{reg: reg, wikiDir: wikiDir})
	if err != nil {
		return report, err
	}
	// Deterministic order, so two runs over the same space produce the same
	// report and a diff of two reports means something (the specification).
	sort.Slice(report.Pages, func(i, j int) bool { return report.Pages[i].Path < report.Pages[j].Path })
	return report, nil
}

// MirrorWiki pushes a wiki's pages out through a source.
//
// It reads the state, offers the pages, hands the source the state to compare
// and record against, and writes the state back. What it does not do is
// reconcile: a page changed on the far side comes back as a conflict, and a
// person decides. Two merge algorithms over one document is the defect this
// avoids — where they disagree the wiki has two states and no tie-break.
func MirrorWiki(ctx context.Context, reg facet.Registry, wikiDir string, src WikiSource) (WikiMirrorReport, error) {
	wiki, err := LoadWiki(wikiDir)
	if err != nil {
		return WikiMirrorReport{}, err
	}
	state, err := LoadWikiMirrorState(wikiDir, src.Name())
	if err != nil {
		return WikiMirrorReport{}, err
	}

	var offered []WikiMirrorPage
	var skipped []string
	for _, page := range wiki.Pages {
		// The one thing a page's own 'mirror:' is for: the exception it
		// declares about itself. The state a machine records lives in
		// .mirror.json, never here.
		if page.Front.Mirror != nil && page.Front.Mirror.Skip {
			skipped = append(skipped, page.Path)
			continue
		}
		space := ""
		if page.Front.Mirror != nil {
			space = page.Front.Mirror.Space
		}
		offered = append(offered, WikiMirrorPage{
			Path:    page.Path,
			Address: page.Address(),
			Title:   page.Front.Title,
			// The prose, not the file. The digest below is still over the whole
			// file, so a header-only edit still counts as a change.
			Body:   page.Body,
			Digest: page.Digest(),
			Space:  space,
		})
	}

	report, err := src.Mirror(ctx, offered, state)
	report.Skipped = append(report.Skipped, skipped...)

	// State is written after a partial failure because a source records an entry
	// only after the far side has answered. Every entry therefore describes a
	// completed push and must remain available to the next run.
	//
	// The consequence was worse than losing work. A 5xx at page 30 of 48 left 29
	// pages standing in the target system that the mirror then disowned: on the
	// next run they are unknown, their titles are already taken, and the report
	// says "a page with this title already exists and this mirror did not create
	// it" — which is false, and which means those 29 pages are never touched
	// again. Keeping the state makes the next run resume; losing it makes the
	// mirror lie about its own work.
	//
	// A run that pushed nothing writes nothing, and that is what keeps this from
	// undoing the second-target refusal: a source that refuses before touching
	// the far side leaves an empty state, and saving it would replace the first
	// target's digests with the emptiness the refusal exists to prevent. The
	// test is what the state holds, not whether the run returned an error —
	// a failure at page one and a refusal at page zero are the same thing here,
	// and both should leave the file alone.
	if len(state.Entries) == 0 {
		return report, err
	}
	// A save failure is not allowed to hide the run's own error, which is the
	// more important of the two.
	if saveErr := SaveWikiMirrorState(wikiDir, state); saveErr != nil && err == nil {
		return report, saveErr
	}
	return report, err
}

// LoadWikiMirrorState reads what was last pushed. A missing file is an empty
// state, which is what a first run has.
func LoadWikiMirrorState(wikiDir, target string) (*WikiMirrorState, error) {
	path := filepath.Join(wikiDir, WikiMirrorStateName)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return &WikiMirrorState{Target: target, Entries: map[string]WikiMirrorEntry{}}, nil
	}
	if err != nil {
		return nil, err
	}
	var state WikiMirrorState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	if state.Entries == nil {
		state.Entries = map[string]WikiMirrorEntry{}
	}
	if state.Target != target {
		// A state file about another target says nothing about this one, and
		// reusing its digests would make every page look unchanged. What it
		// displaced is carried out, so a source may refuse rather than replace
		// it silently.
		displaced := state.Target
		if len(state.Entries) == 0 {
			// A state that pushed nothing has no digests to protect.
			displaced = ""
		}
		return &WikiMirrorState{
			Target:          target,
			Entries:         map[string]WikiMirrorEntry{},
			DisplacedTarget: displaced,
		}, nil
	}
	return &state, nil
}

// SaveWikiMirrorState writes the state back.
func SaveWikiMirrorState(wikiDir string, state *WikiMirrorState) error {
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(wikiDir, WikiMirrorStateName), append(data, '\n'), 0o644)
}

// WikiImportPath brings a source's own file name into the address grammar,
// reporting whether it had to change anything.
//
// Per segment rather than over the whole path, so a folder structure survives
// the rewrite: "Onboarding/First Day.md" becomes "onboarding/first-day.md"
// and stays two levels deep. The caller records the original in 'aliases',
// which is the only thing that writes that field.
//
// A path reaching upward is deliberately NOT cleaned up. Slugging every segment
// would turn "../../.github/workflows/release.yml" into the perfectly legal
// "github/workflows/release.md" — laundering an escape into a name the write
// path would then happily accept, which is the one thing this function must not
// do. Such a name is returned unchanged so the write path refuses it and the
// import reports it, rather than importing a file nobody asked for under a name
// nobody chose.
func WikiImportPath(name string) (string, bool) {
	name = filepath.ToSlash(strings.TrimSpace(name))
	for _, segment := range strings.Split(name, "/") {
		if segment == ".." {
			return name, false
		}
	}
	trimmed := strings.TrimSuffix(name, filepath.Ext(name))

	segments := strings.Split(trimmed, "/")
	out := make([]string, 0, len(segments))
	for _, segment := range segments {
		slug := WikiSlug(segment)
		if slug == "" {
			// A segment that reduces to nothing is dropped rather than turned
			// into a placeholder: "-" is not a name anybody chose.
			continue
		}
		out = append(out, slug)
	}
	if len(out) == 0 {
		return name, false
	}
	result := strings.Join(out, "/") + WikiPageExt
	return result, result != name
}
