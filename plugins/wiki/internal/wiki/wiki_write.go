package wiki

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/facet-framework/core/registry"
)

// Write-path refusals exposed as errors a caller can test for.
//
// Named rather than ad hoc, because three callers refuse through this code —
// the HTTP routes, the agent tools and the CLI — and each has to say the same
// thing about the same refusal. A caller that had to match on message text
// would be a caller free to get it wrong.
var (
	// ErrWikiPathEscape is a path that leaves the wiki directory. Judged after
	// symlinks are resolved: a string prefix is passed by a symlink, and
	// '../../.github/workflows/release.yml' is one HTTP call away from any page
	// that can reach loopback.
	ErrWikiPathEscape = errors.New("path leaves the wiki directory")
	// ErrWikiPathGrammar is a path whose segments or extension are outside the
	// address grammar. The grammar is the barrier rather than a convention.
	ErrWikiPathGrammar = errors.New("path is outside the wiki address grammar")
	// ErrWikiNotAPage is a write that would produce something that is not a
	// page — above all a .yaml. A wiki editor able to write a record is the
	// path by which prose becomes a promise.
	ErrWikiNotAPage = errors.New("only a .md page may be written")
	// ErrWikiExists is a create over a page that is already there.
	ErrWikiExists = errors.New("a page already exists at that path")
	// ErrWikiMissing is an edit or a move of a page that is not there.
	ErrWikiMissing = errors.New("no page at that path")
	// ErrWikiStale is an edit whose caller supplies a digest that the file does
	// not have — somebody else wrote between the read and the edit.
	ErrWikiStale = errors.New("the page changed after it was read")
)

// ResolveWikiPath turns a caller-supplied page path into an absolute one,
// refusing every path outside the wiki address and directory boundaries.
//
// This is the single place the first three refusals live. Every write, every
// move and every field edit goes through it, and so does every caller — a
// second implementation of a refusal is a second door into the same room, which
// is the failure the concept names for the agent tools specifically.
//
// The order matters. The grammar is checked on the path as given, because
// '../..' fails it and saying so is clearer than reporting an escape; then the
// result is resolved and compared against the resolved wiki directory, which is
// the check a symlink cannot walk past.
func ResolveWikiPath(wikiDir, rel string) (string, error) {
	rel = filepath.ToSlash(strings.TrimSpace(rel))
	if rel == "" {
		return "", fmt.Errorf("%w: empty path", ErrWikiPathGrammar)
	}
	if filepath.IsAbs(rel) || strings.HasPrefix(rel, "/") {
		return "", fmt.Errorf("%w: %q is absolute", ErrWikiPathEscape, rel)
	}
	// Said before anything else, because a caller reaching upward is told what
	// it actually did wrong. Reporting '../taxonomy.yaml' as "not a .md file"
	// would be true and would describe the smaller of its two problems.
	for _, segment := range strings.Split(rel, "/") {
		if segment == ".." {
			return "", fmt.Errorf("%w: %q", ErrWikiPathEscape, rel)
		}
	}

	if ext := filepath.Ext(rel); ext != WikiPageExt {
		// Said as its own refusal rather than folded into the grammar, because
		// '.yaml' is the one this feature exists to refuse and a caller
		// deserves to be told which rule it broke.
		return "", fmt.Errorf("%w: %q ends in %q", ErrWikiNotAPage, rel, ext)
	}

	segments := strings.Split(rel, "/")
	for i, segment := range segments {
		name := segment
		if i == len(segments)-1 {
			name = strings.TrimSuffix(segment, WikiPageExt)
		}
		if !wikiSegmentRe.MatchString(name) {
			return "", fmt.Errorf("%w: %q", ErrWikiPathGrammar, segment)
		}
	}

	abs := filepath.Join(wikiDir, filepath.FromSlash(rel))
	if !withinResolved(wikiDir, abs) {
		return "", fmt.Errorf("%w: %q", ErrWikiPathEscape, rel)
	}
	return abs, nil
}

// withinResolved and resolveExisting are Core's path containment checks.
func withinResolved(dir, path string) bool { return facet.WithinResolved(dir, path) }

func resolveExisting(path string) string { return facet.ResolveExisting(path) }

// WriteWikiPage writes a page, creating it or replacing it.
//
// It returns the path it wrote, relative to the wiki directory and
// slash-separated, so a caller can hand exactly that to the commit — which is
// what keeps the commit from ever staging something the host did not write.
func WriteWikiPage(reg facet.Registry, wikiDir, rel, body string) (string, error) {
	if err := wikiInitializationError(reg); err != nil {
		return "", err
	}
	abs, err := ResolveWikiPath(wikiDir, rel)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(abs, []byte(body), 0o644); err != nil {
		return "", err
	}
	return filepath.ToSlash(rel), nil
}

// CreateWikiPage writes a page that must not already exist.
//
// Separate from WriteWikiPage because creating and replacing are different
// intentions, and a tool asked to create a page must not silently replace one
// somebody else wrote. The caller says which it means.
func CreateWikiPage(reg facet.Registry, wikiDir, rel, body string) (string, error) {
	abs, err := ResolveWikiPath(wikiDir, rel)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(abs); err == nil {
		return "", fmt.Errorf("%w: %s", ErrWikiExists, rel)
	}
	return WriteWikiPage(reg, wikiDir, rel, body)
}

// WikiMove reports what a move did, so a commit can stage both halves of it.
type WikiMove struct {
	From string `json:"from"`
	To   string `json:"to"`
	// FromAddress and ToAddress are what the move did to the page's address.
	// Reported because the path *is* the address: renaming a page changes where
	// it is reached, no redirect is stored anywhere, and a caller that does not
	// say so leaves somebody to discover it from a dead link.
	FromAddress string `json:"fromAddress"`
	ToAddress   string `json:"toAddress"`
}

// MoveWikiPage renames or moves a page.
//
// Both ends go through ResolveWikiPath, because a move is a write: a
// destination outside the wiki is refused exactly as a write there would be,
// by the same code rather than by a second copy of the rule.
//
// Moving a page into another folder moves it into another area. No alias or
// redirect is written:
// 'moved_from:' would be a second statement about where a page lives, free to
// disagree with the first, and git already holds the move.
func MoveWikiPage(reg facet.Registry, wikiDir, from, to string) (WikiMove, error) {
	if err := wikiInitializationError(reg); err != nil {
		return WikiMove{}, err
	}
	fromAbs, err := ResolveWikiPath(wikiDir, from)
	if err != nil {
		return WikiMove{}, err
	}
	toAbs, err := ResolveWikiPath(wikiDir, to)
	if err != nil {
		return WikiMove{}, err
	}
	if _, err := os.Stat(fromAbs); err != nil {
		return WikiMove{}, fmt.Errorf("%w: %s", ErrWikiMissing, from)
	}
	if _, err := os.Stat(toAbs); err == nil {
		return WikiMove{}, fmt.Errorf("%w: %s", ErrWikiExists, to)
	}
	if err := os.MkdirAll(filepath.Dir(toAbs), 0o755); err != nil {
		return WikiMove{}, err
	}
	if err := os.Rename(fromAbs, toAbs); err != nil {
		return WikiMove{}, err
	}
	return WikiMove{
		From:        filepath.ToSlash(from),
		To:          filepath.ToSlash(to),
		FromAddress: WikiAddress(from),
		ToAddress:   WikiAddress(to),
	}, nil
}

// Digest is the content hash a caller states when it edits a page it has read.
//
// Content rather than a timestamp: a timestamp compares when a file was touched, and what
// matters is whether it says something different.
func (p WikiPage) Digest() string { return WikiDigest(RenderWikiPage(p.Front, p.Body)) }

// WikiDigest hashes a page's bytes.
func WikiDigest(body string) string {
	sum := sha256.Sum256([]byte(body))
	return hex.EncodeToString(sum[:])
}

// WikiFrontEdit is a change to a page's header, field by field.
//
// Field-wise rather than whole-file, and that is a decision about concurrency
// rather than convenience. Adding a tag is the smallest thing anybody asks for,
// and a tool that rewrote the page to do it would discard whatever somebody
// wrote in the body meanwhile. Here the body is read and written back
// untouched, and only the named fields move.
//
// Every field is a pointer or a list so that "not mentioned" and "set to
// nothing" are different instructions. Clearing a field is asked for by setting
// it to the empty string, which is why Status is a *string and not a string: a
// caller sending an empty struct must change nothing at all.
type WikiFrontEdit struct {
	Title    *string
	Category *string
	Summary  *string
	Status   *string
	Reviewed *string
	Order    *int
	// ClearOrder removes the reading position, which an empty *int cannot
	// express — a pointer to zero means "first", not "unplaced".
	ClearOrder    bool
	AddTags       []string
	RemoveTags    []string
	AddRecords    []string
	RemoveRecords []string
	// IfMatch is the digest the caller last read. Empty skips the check, which
	// is what a caller creating a page has; a caller that read the page states
	// it, and a page that changed underneath is refused rather than overwritten.
	IfMatch string
}

// WikiEdited reports what a header edit did.
type WikiEdited struct {
	Path string `json:"path"`
	// Diff is the unified diff of the change because a write tool produces a
	// proposed diff rather than only reporting success — and
	// because a caller that can show the diff is a caller whose user can refuse
	// it.
	Diff string `json:"diff"`
	// Digest is the page's digest after the edit, so the next edit can state it.
	Digest string `json:"digest"`
}

// EditWikiFront changes named header fields and leaves everything else alone.
func EditWikiFront(reg facet.Registry, wikiDir, rel string, edit WikiFrontEdit) (WikiEdited, error) {
	if err := wikiInitializationError(reg); err != nil {
		return WikiEdited{}, err
	}
	abs, err := ResolveWikiPath(wikiDir, rel)
	if err != nil {
		return WikiEdited{}, err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return WikiEdited{}, fmt.Errorf("%w: %s", ErrWikiMissing, rel)
		}
		return WikiEdited{}, err
	}
	before := string(data)
	if edit.IfMatch != "" && WikiDigest(before) != edit.IfMatch {
		return WikiEdited{}, fmt.Errorf("%w: %s", ErrWikiStale, rel)
	}

	page := parseWikiPage(filepath.ToSlash(rel), data)
	if page.FrontErr != nil {
		// Editing one field of a header nobody can read would mean guessing at
		// the rest of it, and writing the guess back.
		return WikiEdited{}, fmt.Errorf("the page header could not be read: %w", page.FrontErr)
	}

	front := applyWikiFrontEdit(page.Front, edit)
	after, err := editWikiFrontBytes(before, page.Front, front)
	if err != nil {
		return WikiEdited{}, err
	}
	if after == before {
		// Writing an identical file would touch its mtime for nothing, and the
		// caller is owed the honest answer that its edit changed nothing.
		return WikiEdited{Path: filepath.ToSlash(rel), Digest: WikiDigest(before)}, nil
	}
	if err := os.WriteFile(abs, []byte(after), 0o644); err != nil {
		return WikiEdited{}, err
	}
	return WikiEdited{
		Path:   filepath.ToSlash(rel),
		Diff:   UnifiedDiff(filepath.ToSlash(rel), before, after),
		Digest: WikiDigest(after),
	}, nil
}

// applyWikiFrontEdit is the edit itself, kept apart from the file handling so
// that what each field does is readable in one place.
func applyWikiFrontEdit(front WikiFront, edit WikiFrontEdit) WikiFront {
	if edit.Title != nil {
		front.Title = *edit.Title
	}
	if edit.Category != nil {
		front.Category = *edit.Category
	}
	if edit.Summary != nil {
		front.Summary = *edit.Summary
	}
	if edit.Status != nil {
		front.Status = NormalizeWikiStatus(*edit.Status)
	}
	if edit.Reviewed != nil {
		front.Reviewed = *edit.Reviewed
	}
	if edit.ClearOrder {
		front.Order = nil
	} else if edit.Order != nil {
		order := *edit.Order
		front.Order = &order
	}
	if len(edit.AddTags)+len(edit.RemoveTags) > 0 {
		front.Tags = editList(front.Tags, edit.AddTags, edit.RemoveTags)
	}
	if len(edit.AddRecords)+len(edit.RemoveRecords) > 0 {
		front.Records = editList(front.Records, edit.AddRecords, edit.RemoveRecords)
	}
	return front
}

// editList adds and removes from a list, keeping the order the file had.
//
// Order preserved rather than sorted, and additions appended rather than
// inserted: the list is the author's, a tag added today belongs after the ones
// that were there, and re-sorting somebody's tags on an unrelated edit is a
// diff nobody asked for. Removals are taken first so that removing and adding
// the same value in one edit means "keep it, at the end" rather than depending
// on which loop ran last.
func editList(existing, add, remove []string) []string {
	drop := map[string]bool{}
	for _, value := range remove {
		drop[strings.TrimSpace(value)] = true
	}
	out := make([]string, 0, len(existing)+len(add))
	seen := map[string]bool{}
	for _, value := range existing {
		value = strings.TrimSpace(value)
		if value == "" || drop[value] || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	for _, value := range add {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	if len(out) == 0 {
		// An empty list is written as no key at all, because absent is what
		// "none" means everywhere else in this header — and 'tags: []' would be
		// a third state between absent and present.
		return nil
	}
	return out
}

// RenderWikiPage writes a page's header and body back out.
//
// A page read and written back unchanged is byte-identical. A renderer that reflowed, re-quoted
// or reordered would turn every save into a whole-file diff in the pull
// request, and a diff nobody can read is a review nobody does.
//
// Written by hand rather than by marshalling the struct, and that is the whole
// reason this function exists. A YAML marshaller decides quoting, key order and
// list style for itself; here the key order follows the documented header, lists
// are written inline the way the concept's own examples write them, and a value
// is quoted only when it has to be.
func RenderWikiPage(front WikiFront, body string) string {
	var b strings.Builder
	b.WriteString(frontMatterFence + "\n")

	writeScalar(&b, "title", front.Title)
	writeScalar(&b, "category", front.Category)
	writeList(&b, "records", front.Records)
	writeList(&b, "tags", front.Tags)
	writeScalar(&b, "status", NormalizeWikiStatus(front.Status))
	if front.Owner != nil {
		b.WriteString("owner:\n")
		writeIndentedScalar(&b, "  ", "team", front.Owner.Team)
	}
	writeScalar(&b, "reviewed", front.Reviewed)
	if front.Order != nil {
		fmt.Fprintf(&b, "order: %d\n", *front.Order)
	}
	writeScalar(&b, "summary", front.Summary)
	writeList(&b, "aliases", front.Aliases)
	if front.Mirror != nil {
		b.WriteString("mirror:\n")
		writeIndentedScalar(&b, "  ", "target", front.Mirror.Target)
		writeIndentedScalar(&b, "  ", "space", front.Mirror.Space)
		if front.Mirror.Skip {
			b.WriteString("  no-mirror: true\n")
		}
	}

	b.WriteString(frontMatterFence + "\n\n")
	b.WriteString(body)
	return b.String()
}

func writeScalar(b *strings.Builder, key, value string) {
	if value == "" {
		return
	}
	fmt.Fprintf(b, "%s: %s\n", key, wikiScalar(value))
}

func writeIndentedScalar(b *strings.Builder, indent, key, value string) {
	if value == "" {
		return
	}
	fmt.Fprintf(b, "%s%s: %s\n", indent, key, wikiScalar(value))
}

// writeList writes a list the way this format's own examples write them: a
// record list one per line because ids are long and a diff over them should
// name the id that changed, tags inline because they are short and a tag list
// is read as one thing.
func writeList(b *strings.Builder, key string, values []string) {
	if len(values) == 0 {
		return
	}
	if key == "tags" || key == "aliases" {
		quoted := make([]string, 0, len(values))
		for _, v := range values {
			quoted = append(quoted, wikiScalar(v))
		}
		fmt.Fprintf(b, "%s: [%s]\n", key, strings.Join(quoted, ", "))
		return
	}
	fmt.Fprintf(b, "%s:\n", key)
	for _, v := range values {
		fmt.Fprintf(b, "  - %s\n", wikiScalar(v))
	}
}

// wikiScalar quotes a value only when leaving it bare would change what it
// means.
//
// Deliberately laxer than this package's other yamlScalar, which quotes
// anything outside a conservative identifier shape. That is right for a commit
// hash and wrong here: a page's title and summary are sentences, and quoting
// every one of them would rewrite every page in the project the first time
// anything was edited — the whole-file diff exists to prevent that.
func wikiScalar(value string) string {
	if value == "" {
		return `""`
	}
	if strings.ContainsAny(value, ":#\n\"'[]{}|>*&!%@`") ||
		strings.HasPrefix(value, " ") || strings.HasSuffix(value, " ") ||
		reservedScalar(value) {
		return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`).Replace(value) + `"`
	}
	return value
}

// reservedScalar reports whether a bare value would be read back as something
// other than the string it is.
//
// The list is the YAML 1.1 words only. A date is deliberately not on it: every
// field this renders is typed as a string, so 'reviewed: 2026-09-15' comes back
// as the string it went in as — and the concept's own example pages write dates
// bare. Quoting them would rewrite the header of every page in a project the
// first time anything was edited, which the whole-file diff must prevent.
func reservedScalar(value string) bool {
	switch strings.ToLower(value) {
	case "true", "false", "null", "yes", "no", "on", "off", "~":
		return true
	}
	return false
}

// UnifiedDiff renders the change between two versions of a file.
func UnifiedDiff(path, before, after string) string { return facet.UnifiedDiff(path, before, after) }

// NewWikiPage builds the header and scaffold for a page somebody is creating.
//
// A file scaffold rather than a template engine: it writes the header keys and
// a heading, which is enough to stop six people inventing six shapes for a
// how-to, and stops well short of a language.
//
// status is 'draft' and reviewed is absent, deliberately. A new page is a
// draft, and nobody has confirmed it — writing today's date into 'reviewed'
// would be the flattering value nobody measured.
func NewWikiPage(title, category, summary string, records, tags []string) string {
	front := WikiFront{
		Title:    title,
		Category: category,
		Summary:  summary,
		Records:  records,
		Tags:     tags,
		Status:   "draft",
	}
	return RenderWikiPage(front, "")
}

// WikiPageList is a listing of pages, for a CLI or a tool.
type WikiPageList struct {
	Path     string   `json:"path"`
	Address  string   `json:"address"`
	Title    string   `json:"title"`
	Area     string   `json:"area"`
	Category string   `json:"category,omitempty"`
	Tags     []string `json:"tags,omitempty"`
	Records  []string `json:"records,omitempty"`
	Status   string   `json:"status,omitempty"`
	Summary  string   `json:"summary,omitempty"`
	Digest   string   `json:"digest"`
}

// ListWikiPages lists the pages matching a filter, in path order.
//
// Status and reviewed are passed through exactly as the page states them, empty
// included. A listing that filled an absent status with 'maintained' would be
// inventing the flattering value at the one place a reader scans quickly.
func ListWikiPages(w *Wiki, area, category, tag string) []WikiPageList {
	var out []WikiPageList
	for _, p := range w.Pages {
		if area != "" && p.Area() != area {
			continue
		}
		if category != "" && p.Front.Category != category {
			continue
		}
		if tag != "" && !containsString(p.Front.Tags, tag) {
			continue
		}
		out = append(out, WikiPageList{
			Path:     p.Path,
			Address:  p.Address(),
			Title:    p.Front.Title,
			Area:     p.Area(),
			Category: p.Front.Category,
			Tags:     p.Front.Tags,
			Records:  p.Front.Records,
			Status:   p.Front.Status,
			Summary:  p.Front.Summary,
			Digest:   p.Digest(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func containsString(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

// WikiSlug turns a title into a file name in the address grammar.
//
// Lossy on purpose, and the loss is reported by the caller rather than hidden:
// an umlaut is transliterated because the grammar has no room for one, and
// anything else outside [a-z0-9-] becomes a separator. A title that reduces to
// nothing returns "", so a caller can say so instead of writing a file called
// "-.md".
func WikiSlug(title string) string {
	replacer := strings.NewReplacer(
		// Transliterate German characters when forming a slug.
		"\u00e4", "ae", "\u00f6", "oe", "\u00fc", "ue", "\u00df", "ss",
		"\u00c4", "ae", "\u00d6", "oe", "\u00dc", "ue",
		"à", "a", "á", "a", "â", "a", "é", "e", "è", "e", "ê", "e",
		"í", "i", "ì", "i", "ó", "o", "ò", "o", "ô", "o", "ú", "u", "ù", "u",
		"ç", "c", "ñ", "n",
	)
	lowered := replacer.Replace(strings.ToLower(strings.TrimSpace(title)))

	var b strings.Builder
	lastDash := true // leading dashes are dropped: the grammar starts with a letter
	for _, r := range lowered {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
			lastDash = false
		case r >= '0' && r <= '9':
			// A digit may not start a segment, so one at the front is dropped
			// rather than quietly producing a name the grammar refuses.
			if b.Len() > 0 {
				b.WriteRune(r)
				lastDash = false
			}
		default:
			if !lastDash && b.Len() > 0 {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}
