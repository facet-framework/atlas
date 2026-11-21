package wiki

import (
	"bytes"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/facet-framework/core/registry"
	"github.com/goccy/go-yaml"
)

// WikiDirName is the project's prose, inside the records dir.
//
// One place, and no configuration key of its own. .facetrc.yaml already answers
// "where does this project's FACET material live" (the specification), and a second location
// key would reproduce for the prose exactly the failure that file exists to
// remove: a CI job and a developer session disagreeing about where something is
// and both reporting success. A repository declaring several registries gets
// one wiki per registry for free, because each has its own records dir.
const WikiDirName = "wiki"

// WikiConfigName is the wiki's own naming authority, inside the wiki dir.
const WikiConfigName = "wiki.yaml"

// WikiPageExt is the only extension a page has. Anything else under the wiki
// dir — an image, a note, the mirror state — is not prose and is not claimed
// to be.
const WikiPageExt = ".md"

// DefaultWikiDepth is how many folder levels a page may lie under the wiki root
// before the reader and the check say so.
//
// Two: an area and at most one group under it. This is the number the specification
// fixed, kept as the default rather than as a constant so that a project which
// really is deeper can say so once — see WikiConfig.Depth. The limit exists
// because an arbitrarily deep page tree is the property at which a wiki becomes
// unfindable, and nobody chooses it deliberately; they arrive at it one folder
// at a time.
const DefaultWikiDepth = 2

// WikiDir returns where this registry's wiki lives.
func WikiDir(r facet.Registry) string { return filepath.Join(r.RecordsDir, WikiDirName) }

// WikiConfigPath returns where the wiki's declaration lives.
func WikiConfigPath(r facet.Registry) string { return filepath.Join(WikiDir(r), WikiConfigName) }

// WikiOwner is a page's claim about who feels responsible for it.
//
// A claim, and nothing more. Who actually worked on a page is answered by git,
// which knows it more precisely and without anybody maintaining it; this field
// says who has put their name to the content. Absent means nobody claimed it,
// which is not the same as nobody having written it.
type WikiOwner struct {
	Team string `yaml:"team"`
}

// WikiMirror is what a page declares about being mirrored elsewhere.
//
// Only the exception, never the state: which target and space it belongs to,
// and whether it is held back. What was last pushed and what its digest was
// lives in .mirror.json, because a marker in the header would rewrite every
// page on every mirror run and put a machine's bookkeeping into a file a person
// edits (the specification).
type WikiMirror struct {
	Target string `yaml:"target"`
	Space  string `yaml:"space"`
	Skip   bool   `yaml:"no-mirror"`
}

// UnmarshalYAML accepts localized field names.
func (m *WikiMirror) UnmarshalYAML(data []byte) error {
	type plain struct {
		Target string `yaml:"target"`
		Space  string `yaml:"space"`
		Skip   *bool  `yaml:"no-mirror"`
	}
	var p plain
	data, err := normalizeWikiKeys(data)
	if err != nil {
		return err
	}
	if err := yaml.Unmarshal(data, &p); err != nil {
		return err
	}
	m.Target, m.Space = p.Target, p.Space
	switch {
	case p.Skip != nil:
		m.Skip = *p.Skip
	default:
		m.Skip = false
	}
	return nil
}

// WikiFront is a page's header: the eleven keys of the specification and no others.
//
// Readers accept legacy German keys; writers use English. Area comes from
// the folder, and identity from the path. Dates and authors remain git data.
type WikiFront struct {
	Title    string `yaml:"title"`
	Category string `yaml:"category"`
	Tags     []string
	Records  []string
	// Status is what the author says about the page's state. Empty means
	// nobody said, which a surface must render as "nobody has explained the
	// state of this page" and never as the flattering value.
	Status string `yaml:"status"`
	Owner  *WikiOwner
	// Reviewed is when a person last confirmed the content. Empty means never
	// confirmed — never the date of the last commit, which measures something
	// else entirely.
	Reviewed string `yaml:"reviewed"`
	// Order is a pointer because absent and zero are different answers: a page
	// nobody placed in a reading order is not the first page.
	Order   *int
	Summary string
	// Aliases contains prior external page addresses recorded by the importer
	// so existing links can resolve to this page.
	Aliases []string
	Mirror  *WikiMirror
}

// UnmarshalYAML normalizes legacy front matter without changing the body.
func (f *WikiFront) UnmarshalYAML(data []byte) error {
	type plain WikiFront
	normalized, err := normalizeWikiKeys(data)
	if err != nil {
		return err
	}
	var p plain
	if err := yaml.Unmarshal(normalized, &p); err != nil {
		return err
	}
	*f = WikiFront(p)
	f.Status = NormalizeWikiStatus(f.Status)
	return nil
}

// NormalizeWikiStatus maps localized labels to canonical status values.
func NormalizeWikiStatus(status string) string {
	if value, ok := wikiStatusAliases[status]; ok {
		return value
	}
	return status
}

// normalizeWikiKeys retains order and lets an explicit English key win, even
// when its value is empty. Nested maps are normalized by their own readers.
func normalizeWikiKeys(data []byte) ([]byte, error) {
	var fields yaml.MapSlice
	if err := yaml.UnmarshalWithOptions(data, &fields, yaml.UseOrderedMap()); err != nil {
		return nil, err
	}
	present := map[string]bool{}
	for _, field := range fields {
		if key, ok := field.Key.(string); ok {
			present[key] = true
		}
	}
	out := yaml.MapSlice{}
	for _, field := range fields {
		if key, ok := field.Key.(string); ok {
			if english, legacy := wikiKeyAliases[key]; legacy {
				if present[english] {
					continue
				}
				field.Key = english
			}
		}
		out = append(out, field)
	}
	return yaml.Marshal(out)
}

// WikiPage is one page: where it is, what its header says, and its prose.
type WikiPage struct {
	// Path is the page's path under the wiki dir, slash-separated. It is the
	// page's identity: there is no stored id, so moving the file moves the
	// page, which is what a person moving a file means.
	Path  string
	Front WikiFront
	// Body is the prose after the header, byte for byte as it was written.
	Body string
	// FrontErr holds why the header could not be read, when it could not be.
	// A page whose YAML is broken is still a page and is still listed; what it
	// is not is a page whose header anybody may rely on.
	FrontErr error
}

// Area reports the topmost folder the page lies in — the one axis of the specification that
// comes from the path rather than from the header.
//
// Empty for a page directly under the wiki dir. That is a state the concept
// does not name, and it is reported as itself rather than filed under an
// invented area, for the reason the specification gives about "Other".
func (p WikiPage) Area() string {
	if i := strings.Index(p.Path, "/"); i > 0 {
		return p.Path[:i]
	}
	return ""
}

// Folder reports the folder the page lies in, slash-separated and relative to
// the wiki dir. Empty for a page at the root.
func (p WikiPage) Folder() string {
	if i := strings.LastIndex(p.Path, "/"); i > 0 {
		return p.Path[:i]
	}
	return ""
}

// IsIndex reports whether this page is its folder's front page (the specification).
func (p WikiPage) IsIndex() bool { return filepath.Base(p.Path) == "index"+WikiPageExt }

// Address returns the page's wiki address.
func (p WikiPage) Address() string { return WikiAddress(p.Path) }

// Depth reports how many folder levels the page lies under the wiki root.
func (p WikiPage) Depth() int { return WikiDepth(p.Path) }

// WikiAddress turns a page path under the wiki dir into the address a reader
// puts in a link.
//
// The keyword and colon in front are load-bearing rather than decorative.
// Atlas keeps its location in the fragment and recognises a record id by three
// lower-case segments, so 'onboarding/first-day/part-two' would be read as a
// record id and silently not found. A leading 'wiki:' is the form this project
// already uses to say which namespace a name belongs to — the registry prefix
// on an anchor (the specification) — so it is one rule, not a new one.
func WikiAddress(rel string) string {
	trimmed := strings.TrimSuffix(filepath.ToSlash(rel), WikiPageExt)
	// An index page is the page of its folder, so its address is the folder's:
	// wiki/onboarding/index.md is reached at wiki:onboarding, and a reader
	// following that address lands on prose somebody wrote rather than on a
	// generated list.
	trimmed = strings.TrimSuffix(trimmed, "/index")
	if trimmed == "index" {
		trimmed = ""
	}
	return "wiki:" + trimmed
}

// WikiDepth reports how many folder levels a page path lies under the wiki
// root: one for wiki/<area>/<page>.md, two for wiki/<area>/<group>/<page>.md.
func WikiDepth(rel string) int { return strings.Count(filepath.ToSlash(rel), "/") }

// WikiArea is one declared area: the answer to "where does this live".
//
// Deliberately without a list of the pages in it, and without a depth of its
// own. The files under the folder are the pages, and the depth limit is a
// property of the wiki rather than of one folder — a per-area limit would let
// two areas of one wiki disagree about how deep a wiki may be, which is a
// question with one answer.
type WikiArea struct {
	Title   string `yaml:"title"`
	Purpose string `yaml:"purpose"`
	// Domain optionally says that this area is the taxonomy domain of that
	// name. A bridge and nothing more: it claims the two mean the same thing,
	// and it never makes the taxonomy responsible for naming a place prose
	// lives.
	Domain string `yaml:"domain"`
}

// WikiCategory is one declared category: the answer to "what is this".
//
// A list rather than a map, and closed rather than free, for the reason the specification
// gives: the category drives how a page is presented, and a presentation rule
// switching on an open set of strings is a rule that quietly stops matching.
type WikiCategory struct {
	ID      string `yaml:"id"`
	Title   string `yaml:"title"`
	Purpose string `yaml:"purpose"`
}

// WikiAreas is the declared areas in the order the file declares them.
//
// Ordered, because the order is the project's own and a reader shows the areas
// as declared; a plain Go map would surrender that order to whatever
// order the parser hands back, leaving a surface to sort alphabetically, which
// is an opinion about which area comes first.
type WikiAreas struct {
	names []string
	byID  map[string]WikiArea
}

// UnmarshalYAML reads the mapping while keeping its key order.
func (a *WikiAreas) UnmarshalYAML(data []byte) error {
	var ordered yaml.MapSlice
	if err := yaml.Unmarshal(data, &ordered); err != nil {
		return err
	}
	a.names = nil
	a.byID = map[string]WikiArea{}
	for _, item := range ordered {
		id, ok := item.Key.(string)
		if !ok || strings.TrimSpace(id) == "" {
			continue
		}
		body, err := yaml.Marshal(item.Value)
		if err != nil {
			return err
		}
		var area WikiArea
		if err := yaml.Unmarshal(body, &area); err != nil {
			return err
		}
		if _, seen := a.byID[id]; !seen {
			a.names = append(a.names, id)
		}
		a.byID[id] = area
	}
	return nil
}

// Names lists the declared areas in declared order.
func (a *WikiAreas) Names() []string {
	if a == nil {
		return nil
	}
	return append([]string(nil), a.names...)
}

// Get returns a declared area.
func (a *WikiAreas) Get(id string) (WikiArea, bool) {
	if a == nil {
		return WikiArea{}, false
	}
	area, ok := a.byID[id]
	return area, ok
}

// WikiConfig is what a project declares about its wiki: the names of its areas
// and categories, and how deep it allows itself to go.
//
// A naming authority, as the taxonomy and the glossary are (the specification). It has no
// lifecycle, no contract and no anchor, and it never lists the pages — the
// files are the truth, exactly as records are the truth beneath a taxonomy
// node.
//
// Its schema_version is its own small line rather than the FACET family's: this
// file is not a record and does not move when the record schema does.
type WikiConfig struct {
	SchemaVersion string `yaml:"schema_version"`
	Areas         *WikiAreas
	Categories    []WikiCategory `yaml:"categories"`
	// Depth is the declared limit, absent by default. A pointer because absent
	// and zero are different: a wiki declaring 'depth: 0' would be saying every
	// page sits at the root, which is a thing a project may say.
	Depth *int `yaml:"depth"`
}

// UnmarshalYAML preserves declared area order and accepts legacy keys.
func (c *WikiConfig) UnmarshalYAML(data []byte) error {
	type plain struct {
		SchemaVersion string         `yaml:"schema_version"`
		Areas         *WikiAreas     `yaml:"areas"`
		Categories    []WikiCategory `yaml:"categories"`
		Depth         *int           `yaml:"depth"`
	}
	var p plain
	data, err := normalizeWikiKeys(data)
	if err != nil {
		return err
	}
	if err := yaml.Unmarshal(data, &p); err != nil {
		return err
	}
	c.SchemaVersion, c.Areas, c.Categories, c.Depth = p.SchemaVersion, p.Areas, p.Categories, p.Depth
	return nil
}

// AreaNames lists the declared areas in the order the file declares them.
func (c *WikiConfig) AreaNames() []string {
	if c == nil {
		return nil
	}
	return c.Areas.Names()
}

// CategoryIDs lists the declared category ids in declared order.
func (c *WikiConfig) CategoryIDs() []string {
	if c == nil {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, cat := range c.Categories {
		id := strings.TrimSpace(cat.ID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// Wiki is a project's prose as it stands on disk.
type Wiki struct {
	// Dir is where the wiki lives, absolute.
	Dir string
	// Present reports whether the directory exists at all.
	//
	// The distinction between this and an empty Pages is the whole point: a
	// project with no wiki has not adopted one, a wiki with no pages has and
	// has written nothing yet, and a surface shown the same thing for both
	// would report the first as a wiki somebody emptied.
	Present bool
	// Config is the declaration, nil when the project writes none. An absent
	// declaration claims nothing: every folder is an undeclared area, every
	// category is unknown, and every page is still shown.
	Config *WikiConfig
	// ConfigErr holds why the declaration could not be read, when it could not
	// be. A wiki.yaml that will not parse is a finding about that file and not
	// a reason to stop reading the pages beside it.
	ConfigErr error
	// Pages are the pages, sorted by path so a run is reproducible (the specification).
	Pages []WikiPage
}

// LoadWiki reads a wiki from disk. A missing directory is not an error — it
// means the project has not written one.
func LoadWiki(dir string) (*Wiki, error) {
	w := &Wiki{Dir: dir}
	st, err := os.Stat(dir)
	if os.IsNotExist(err) {
		return w, nil
	}
	if err != nil {
		return nil, err
	}
	if !st.IsDir() {
		return w, nil
	}
	w.Present = true

	if data, err := os.ReadFile(filepath.Join(dir, WikiConfigName)); err == nil {
		var cfg WikiConfig
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			w.ConfigErr = err
		} else {
			w.Config = &cfg
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	err = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || filepath.Ext(path) != WikiPageExt {
			return nil
		}
		rel, relErr := filepath.Rel(dir, path)
		if relErr != nil {
			return relErr
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		w.Pages = append(w.Pages, parseWikiPage(filepath.ToSlash(rel), data))
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(w.Pages, func(i, j int) bool { return w.Pages[i].Path < w.Pages[j].Path })
	return w, nil
}

// parseWikiPage splits a page into its header and its prose.
func parseWikiPage(rel string, data []byte) WikiPage {
	page := WikiPage{Path: rel}
	front, body, found := SplitFrontMatter(data)
	page.Body = string(body)
	if !found {
		// A page without a header is a page whose title nobody wrote, which
		// the check reports. It is not a parse failure, and treating it as one
		// would make an ordinary Markdown file dropped into the folder look
		// corrupt rather than incomplete.
		return page
	}
	if err := yaml.Unmarshal(front, &page.Front); err != nil {
		page.FrontErr = err
	}
	return page
}

// frontMatterFence is the line that opens and closes a YAML header.
const frontMatterFence = "---"

// SplitFrontMatter separates a page's YAML header from its prose: Core's
// reading of a Markdown header, which this package's pages share.
func SplitFrontMatter(data []byte) (front, body []byte, ok bool) {
	return facet.SplitFrontMatter(data)
}

// cutFence removes an opening header fence, reporting whether there was one.
func cutFence(data []byte) ([]byte, bool) {
	line, next := lineAt(data, 0)
	if strings.TrimRight(string(line), "\r") != frontMatterFence {
		return data, false
	}
	return data[next:], true
}

// lineAt returns the line beginning at offset and where the next one begins.
func lineAt(data []byte, offset int) (line []byte, next int) {
	end := bytes.IndexByte(data[offset:], '\n')
	if end < 0 {
		return data[offset:], len(data)
	}
	return data[offset : offset+end], offset + end + 1
}

// Page returns the page at a path under the wiki dir.
func (w *Wiki) Page(rel string) (WikiPage, bool) {
	if w == nil {
		return WikiPage{}, false
	}
	for _, p := range w.Pages {
		if p.Path == rel {
			return p, true
		}
	}
	return WikiPage{}, false
}

// PagePaths lists the page paths, in order.
func (w *Wiki) PagePaths() []string {
	if w == nil {
		return nil
	}
	out := make([]string, 0, len(w.Pages))
	for _, p := range w.Pages {
		out = append(out, p.Path)
	}
	return out
}

// WikiFolder is one folder of the page tree, and what labels it.
//
// The tree itself is never stored anywhere — it is the file tree, which is why
// no header key and no key in wiki.yaml names a parent, a child or a branch.
// This type only answers what a folder is called, which is a question the file
// tree alone cannot answer.
type WikiFolder struct {
	// Path is the folder's path under the wiki dir.
	Path string
	// Title is what to show. When Titled is false it is the folder's own name,
	// which a surface shows as the folder name it is rather than as a title
	// somebody wrote.
	Title  string
	Titled bool
	// Summary and Order come from the folder's index page, and stay empty when
	// there is none. Nothing is invented for a folder nobody described.
	Summary string
	Order   *int
	// Pages is how many pages lie directly in this folder, index page included.
	Pages int
}

// Folder reports what labels a folder of the page tree.
//
// An index
// page's title, summary and order describe the *folder*, not a page inside it.
// Without one the folder name stands — the honest state, and not an error: a
// folder nobody has written a front page for is a folder nobody has written a
// front page for.
func (w *Wiki) Folder(path string) (WikiFolder, bool) {
	if w == nil {
		return WikiFolder{}, false
	}
	folder := WikiFolder{Path: path, Title: path, Titled: false}
	if i := strings.LastIndex(path, "/"); i >= 0 {
		folder.Title = path[i+1:]
	}
	found := false
	for _, p := range w.Pages {
		if p.Folder() != path {
			continue
		}
		found = true
		folder.Pages++
		if !p.IsIndex() {
			continue
		}
		if title := strings.TrimSpace(p.Front.Title); title != "" {
			folder.Title, folder.Titled = title, true
		}
		folder.Summary = strings.TrimSpace(p.Front.Summary)
		folder.Order = p.Front.Order
	}
	// A folder that holds only subfolders still exists, and a reader walking
	// the tree has to be able to name it.
	if !found {
		for _, p := range w.Pages {
			if strings.HasPrefix(p.Path, path+"/") {
				found = true
				break
			}
		}
	}
	return folder, found
}

// DepthLimit reports how deep this wiki allows itself to be.
func (w *Wiki) DepthLimit() int {
	if w != nil && w.Config != nil && w.Config.Depth != nil {
		return *w.Config.Depth
	}
	return DefaultWikiDepth
}

// TooDeep reports whether a page path lies past the declared limit.
func (w *Wiki) TooDeep(rel string) bool { return WikiDepth(rel) > w.DepthLimit() }

// AreaDeclared reports whether wiki.yaml declares an area.
func (w *Wiki) AreaDeclared(id string) bool {
	if w == nil || w.Config == nil {
		return false
	}
	_, ok := w.Config.Areas.Get(id)
	return ok
}

// CategoryDeclared reports whether wiki.yaml declares a category id.
func (w *Wiki) CategoryDeclared(id string) bool {
	if w == nil || w.Config == nil {
		return false
	}
	for _, c := range w.Config.Categories {
		if strings.TrimSpace(c.ID) == id {
			return true
		}
	}
	return false
}

// Areas lists every area the wiki has, declared ones first in declared order
// and then the folders no declaration names, sorted.
//
// Both kinds are listed, and that is the point: a declared area with no page is
// shown as "declared, no page yet" and an undeclared folder is shown with its
// own name marked as undeclared. Neither is hidden — the same treatment the
// glossary gives a category nothing uses and a category nothing declares.
func (w *Wiki) Areas() []string {
	if w == nil {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, id := range w.Config.AreaNames() {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	var undeclared []string
	for _, p := range w.Pages {
		area := p.Area()
		if area == "" || seen[area] {
			continue
		}
		seen[area] = true
		undeclared = append(undeclared, area)
	}
	sort.Strings(undeclared)
	return append(out, undeclared...)
}
