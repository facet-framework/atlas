package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
)

// ConfluenceSourceName is what this source is called on a command line and in
// the mirror state's 'target'.
const ConfluenceSourceName = "confluence"

// ErrConfluenceOtherTarget is a mirror run against a second target.
//
// The state file holds one target. wiki.LoadWikiMirrorState answers an empty state
// when a different one asks, which is right for reading — foreign digests would
// make every page look unchanged — but on its own it means the next save
// replaces the first target's digests with the second's, and the first target's
// next run pushes every page again with nothing anywhere saying why.
//
// So the second target is refused rather than allowed to forget. It is the same
// policy the far side gets: detect, refuse, report. The alternative — keying
// entries by target inside one file — is the larger change and the more honest
// one for somebody who genuinely wants two spaces; it is named in the pull
// request as the next step rather than done here, because widening the state
// file's shape is a change to a format three other things read.
var ErrConfluenceOtherTarget = errors.New("the mirror state belongs to another target")

// ConfluenceSource is the live adapter: a Confluence Cloud space in, a
// Confluence page tree out.
//
// It holds a client and nothing else. No credential is stored on it beyond what
// the client read from the environment, and nothing it writes — reports, state,
// pages — carries one.
type ConfluenceSource struct {
	client *confluenceClient
	// space is the key a mirror pushes into, from the command line.
	space string
	// replacedExisting collects the pages an import overwrote, so the report can
	// say so rather than leaving somebody to find it in a diff.
	replacedExisting []string
	// calls is where a caller reads what a run cost.
	calls func() int
}

// NewConfluenceSource builds the adapter, reading credentials from the
// environment.
func NewConfluenceSource(space string) (*ConfluenceSource, error) {
	client, err := newConfluenceClient()
	if err != nil {
		return nil, err
	}
	return &ConfluenceSource{
		client: client,
		space:  space,
		calls:  func() int { return client.calls },
	}, nil
}

// Name is what this source is called — and what the mirror state is keyed on.
//
// The space is part of it. wiki.MirrorWiki loads the state by exactly this string, so
// a Name() that answered the bare "confluence" while the state recorded
// "confluence:ENG" would make every load see a foreign target, hand back an
// empty state, and re-create every page on every run — with .mirror.json looking
// perfectly well-formed the whole time. The two have to be one string, so there
// is one method and Detect does the naming that a command line needs.
func (s *ConfluenceSource) Name() string { return s.targetName() }

// Calls reports how many requests this source has made, so a caller can say what
// a run cost rather than estimate it.
func (s *ConfluenceSource) Calls() int {
	if s.calls == nil {
		return 0
	}
	return s.calls()
}

// confluencePageURL matches the two shapes a Confluence Cloud page URL takes.
var confluencePageURL = regexp.MustCompile(
	`/wiki/spaces/([^/]+)/pages/(\d+)|/wiki/spaces/([^/?#]+)/?$`)

// Detect reports whether a reference is this source's.
//
// Three shapes: the explicit 'confluence:KEY' a command line uses, a space URL,
// and a page URL. A bare space key is deliberately NOT claimed — 'ENG' is a
// string any source could want, and a source that claimed it would take
// references meant for somebody else.
func (s *ConfluenceSource) Detect(ref string) bool {
	ref = strings.TrimSpace(ref)
	if strings.HasPrefix(ref, ConfluenceSourceName+":") {
		return true
	}
	parsed, err := url.Parse(ref)
	if err != nil || parsed.Host == "" {
		return false
	}
	return strings.Contains(parsed.Path, "/wiki/spaces/")
}

// confluenceRef is what a reference resolves to.
type confluenceRef struct {
	// spaceKey is set when the whole space was named.
	spaceKey string
	// pageID is set when a single page or a subtree was named.
	pageID string
	// subtree reports whether the page's children come too.
	subtree bool
}

// ParseConfluenceRef reads what a reference asks for.
//
// The three the concept names: a whole space, one page, a page and its subtree.
// '+' on the end of a page reference is the subtree — chosen because it is the
// one character that survives a shell, a URL and a YAML scalar without quoting.
func ParseConfluenceRef(ref string) (confluenceRef, error) {
	ref = strings.TrimSpace(ref)
	out := confluenceRef{}
	if strings.HasSuffix(ref, "+") {
		out.subtree = true
		ref = strings.TrimSuffix(ref, "+")
	}

	if rest, ok := strings.CutPrefix(ref, ConfluenceSourceName+":"); ok {
		rest = strings.TrimSpace(rest)
		if rest == "" {
			return out, fmt.Errorf("a confluence reference needs a space key or a page id")
		}
		// A run of digits is a page id; anything else is a space key. Space keys
		// may not be numeric in Confluence, so this is not ambiguous.
		if isAllDigits(rest) {
			out.pageID = rest
			return out, nil
		}
		out.spaceKey = rest
		return out, nil
	}

	parsed, err := url.Parse(ref)
	if err != nil {
		return out, fmt.Errorf("not a confluence reference: %q", ref)
	}
	match := confluencePageURL.FindStringSubmatch(parsed.Path)
	if match == nil {
		return out, fmt.Errorf("not a confluence space or page URL: %q", ref)
	}
	if match[2] != "" {
		out.pageID = match[2]
		return out, nil
	}
	out.spaceKey = match[1] + match[3]
	return out, nil
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// Import brings a space, a page or a subtree in as .md files.
//
// Every file goes through the wiki.WikiWriter it was handed, which is the wiki's own
// write path with its six refusals. That matters more here than anywhere else in
// the design: a Confluence page title is whatever somebody typed, and
// '../../.github/workflows/release' is a title Confluence accepts. The import
// does not sanitise such a title into something legal — wiki.WikiImportPath returns
// it untouched precisely so the write path refuses it and this report names it.
func (s *ConfluenceSource) Import(ctx context.Context, ref string, into wiki.WikiWriter) (wiki.WikiImportReport, error) {
	parsed, err := ParseConfluenceRef(ref)
	if err != nil {
		return wiki.WikiImportReport{}, err
	}
	report := wiki.WikiImportReport{Source: ConfluenceSourceName, Ref: ref}

	pages, area, err := s.collect(ctx, parsed)
	if err != nil {
		return report, err
	}

	tree := buildConfluenceTree(pages)
	for _, node := range tree.ordered() {
		s.importOne(node, tree, area, into, &report)
	}

	// Said once per page that was already there, rather than once per run: the
	// report is read per page, and a single line at the top is a line somebody
	// scrolls past. Emitted only when a file was actually replaced, so a first
	// import does not carry a warning about something that did not happen.
	for _, replaced := range s.replacedExisting {
		report.Lost = append(report.Lost, wiki.WikiLoss{
			Page: replaced,
			What: "local edits",
			Why:  wiki.ConfluenceRepeatedImportWarning,
		})
	}
	s.replacedExisting = nil

	sort.Slice(report.Lost, func(i, j int) bool {
		if report.Lost[i].Page != report.Lost[j].Page {
			return report.Lost[i].Page < report.Lost[j].Page
		}
		return report.Lost[i].Why < report.Lost[j].Why
	})
	sort.Slice(report.Refused, func(i, j int) bool { return report.Refused[i].Page < report.Refused[j].Page })
	return report, nil
}

// collect fetches what the reference asked for, and decides the area the pages
// land under.
func (s *ConfluenceSource) collect(ctx context.Context, ref confluenceRef) ([]confluencePage, string, error) {
	if ref.spaceKey != "" {
		space, err := s.client.space(ctx, ref.spaceKey)
		if err != nil {
			return nil, "", err
		}
		pages, err := s.client.pagesInSpace(ctx, space.ID)
		if err != nil {
			return nil, "", err
		}
		// The space key as the area, slugged. Not the space's name: a name is
		// prose somebody may rewrite, and the key is the identifier that does
		// not move.
		area := wiki.WikiSlug(space.Key)
		if area == "" {
			area = "confluence"
		}
		return pages, area, nil
	}

	root, err := s.client.page(ctx, ref.pageID)
	if err != nil {
		return nil, "", err
	}
	pages := []confluencePage{root}
	if ref.subtree {
		gathered, err := s.descend(ctx, root.ID, 0)
		if err != nil {
			return nil, "", err
		}
		pages = append(pages, gathered...)
	}
	area := wiki.WikiSlug(root.Title)
	if area == "" {
		area = "page-" + root.ID
	}
	return pages, area, nil
}

// confluenceMaxDepth bounds how far a subtree walk descends.
//
// A bound rather than none, because a cycle in the parent chain — which a
// corrupted page tree can present — would otherwise be an infinite walk against
// somebody's live instance. Ten is far past what the wiki itself allows and far
// past any handbook anybody reads.
const confluenceMaxDepth = 10

// descend gathers a page's children, depth first.
func (s *ConfluenceSource) descend(ctx context.Context, id string, depth int) ([]confluencePage, error) {
	if depth >= confluenceMaxDepth {
		return nil, nil
	}
	children, err := s.client.children(ctx, id)
	if err != nil {
		return nil, err
	}
	var out []confluencePage
	for _, child := range children {
		// The children endpoint does not carry bodies, so each page is read
		// again for its storage format. That is the cost of the v2 API's shape
		// rather than a choice: a collection endpoint offers no 'view' and the
		// child list is metadata only.
		full, err := s.client.page(ctx, child.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, full)
		deeper, err := s.descend(ctx, child.ID, depth+1)
		if err != nil {
			return nil, err
		}
		out = append(out, deeper...)
	}
	return out, nil
}

// importOne converts a page and writes it.
func (s *ConfluenceSource) importOne(node *confluenceNode, tree *confluenceTree, area string, into wiki.WikiWriter, report *wiki.WikiImportReport) {
	page := node.page
	markdown, macros, err := ConfluenceToMarkdown(page.Body.Storage.Value)
	if err != nil {
		report.Refused = append(report.Refused, wiki.WikiLoss{
			Page: page.Title,
			What: "body",
			Why:  "the storage format could not be read: " + err.Error(),
		})
		return
	}

	rel := tree.pathFor(node, area)
	front := wiki.WikiFront{
		Title: page.Title,
		// The Confluence URL, so a link from outside does not land nowhere. The
		// one thing that field is for — and, as the sync design paper notes, it
		// says the page was once reachable there, never that it is still
		// maintained there.
		Aliases: []string{confluenceWebURL(s.client.base, page)},
	}
	if front.Title == "" {
		// A page has to declare a title (the specification), and a Confluence page without
		// one is a page somebody left untitled rather than a page with no
		// identity. The id is used as the text so the header is readable, and
		// the report says the title was missing.
		front.Title = "Confluence page " + page.ID
		report.Lost = append(report.Lost, wiki.WikiLoss{
			Page: page.Title,
			What: "title",
			Why:  "the Confluence page has no title; the page id stands in its place",
		})
	}

	written, replaced, err := writeReporting(into, rel, wiki.RenderWikiPage(front, markdown))
	if replaced {
		s.replacedExisting = append(s.replacedExisting, rel)
	}
	if err != nil {
		report.Refused = append(report.Refused, wiki.WikiLoss{
			Page: page.Title,
			What: "path",
			Why:  err.Error(),
		})
		return
	}

	imported := wiki.WikiImportedPage{Path: written, Aliases: front.Aliases}
	if node.renamed {
		imported.RenamedFrom = page.Title
	}
	report.Pages = append(report.Pages, imported)
	report.Lost = append(report.Lost, ConfluenceLossesFor(page.Title, macros)...)
	report.Lost = append(report.Lost, confluenceCarriedLosses(s.client.base, page)...)
}

// writeReporting writes through the writer, using the richer interface when the
// caller supplied one.
//
// A source is handed a wiki.WikiWriter and may be handed one that can say more. The
// fallback is the plain write and "nothing was replaced" — which is not a guess
// but the honest answer for a writer that does not know: the warning is then not
// emitted, rather than emitted on a run that may not have overwritten anything.
func writeReporting(into wiki.WikiWriter, rel, body string) (string, bool, error) {
	if reporting, ok := into.(wiki.WikiReplacingWriter); ok {
		return reporting.WriteReporting(rel, body)
	}
	written, err := into.Write(rel, body)
	return written, false, err
}

// confluenceCarriedLosses names what a page carried that the wiki does not.
//
// The four the specification lists as reported-not-carried, plus the attachments and mentions
// the body holds. Every one of them was silent before: a page with restricted
// permissions arrived readable by anyone with the repository and nothing said
// so, and an image arrived as a link to a file nobody downloaded.
//
// Permissions and version history are reported per page from what the API
// already returned, so no extra request is made to say them. Comments and labels
// are NOT claimed here: this adapter does not fetch either, and a line saying
// "0 comments" about a page nobody asked about would be the invented value in
// its most ordinary form. What is said instead is that they were not looked at.
func confluenceCarriedLosses(base string, page confluencePage) []wiki.WikiLoss {
	var out []wiki.WikiLoss

	images, mentions := ConfluenceAttachments(page.Body.Storage.Value)
	for _, image := range images {
		out = append(out, wiki.WikiLoss{
			Page: page.Title,
			What: "attachment",
			Why: fmt.Sprintf("the attachment %q is referenced but not downloaded — "+
				"the link in the page points at a file this import did not fetch", image),
		})
	}
	if mentions > 0 {
		out = append(out, wiki.WikiLoss{
			Page: page.Title,
			What: "mentions",
			Why: fmt.Sprintf("%d user mention(s) became the account id — the wiki has no "+
				"directory to resolve a Confluence account into a person", mentions),
		})
	}

	if page.Version.Number > 1 {
		out = append(out, wiki.WikiLoss{
			Page: page.Title,
			What: "versions",
			Why: fmt.Sprintf("only the latest of %d versions came across; git is the history "+
				"from here, and the earlier ones stay in Confluence", page.Version.Number),
		})
	}
	out = append(out, wiki.WikiLoss{
		Page: page.Title,
		What: "permissions",
		Why: "page restrictions are not carried and were not read — the wiki has none, " +
			"so this page is readable by everyone who can read the repository",
	})
	out = append(out, wiki.WikiLoss{
		Page: page.Title,
		What: "comments",
		Why: "comments and labels were not fetched and are not carried — the wiki has " +
			"neither, and this import did not look at how many there were",
	})
	return out
}

// confluenceWebURL is where a page lives, for the alias.
func confluenceWebURL(base string, page confluencePage) string {
	if page.Links.WebUI != "" {
		return base + "/wiki" + page.Links.WebUI
	}
	return base + "/wiki/pages/viewpage.action?pageId=" + page.ID
}

// confluenceNode is one page in the tree being imported.
type confluenceNode struct {
	page     confluencePage
	children []*confluenceNode
	parent   *confluenceNode
	// slug is this page's own path segment.
	slug string
	// renamed reports whether the title had to change to become a path.
	renamed bool
}

// confluenceTree is the page tree as it will land on disk.
type confluenceTree struct {
	roots []*confluenceNode
	all   []*confluenceNode
}

// buildConfluenceTree reconstructs the parent/child shape from a flat list.
//
// The shape is the point. A Confluence page with children becomes a folder with
// that page as its index.md; a page without becomes a file. Flattening the tree
// would be a decision nobody made, and a wiki whose handbook lost its structure
// is a wiki somebody has to re-file by hand.
func buildConfluenceTree(pages []confluencePage) *confluenceTree {
	byID := map[string]*confluenceNode{}
	// Sorted by id so two runs over the same space build the same tree and
	// produce the same report (the specification). The API's own order is not promised.
	sorted := append([]confluencePage(nil), pages...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })

	for i := range sorted {
		node := &confluenceNode{page: sorted[i]}
		byID[sorted[i].ID] = node
	}
	tree := &confluenceTree{}
	for _, page := range sorted {
		node := byID[page.ID]
		tree.all = append(tree.all, node)
		if parent, ok := byID[page.ParentID]; ok && page.ParentID != "" {
			node.parent = parent
			parent.children = append(parent.children, node)
			continue
		}
		// A page whose parent was not in the set is a root here — which is what
		// a subtree import produces, and what a space's homepage is.
		tree.roots = append(tree.roots, node)
	}

	tree.assignSlugs()
	return tree
}

// assignSlugs gives every node a path segment, resolving collisions.
//
// Collisions are resolved per parent rather than globally, because two pages
// called "Setup" under different parents are not a collision on disk. The second
// one gets a numeric suffix and both are reported as renamed, so somebody can go
// and rename one in Confluence rather than living with 'setup-2'.
func (t *confluenceTree) assignSlugs() {
	var assign func(siblings []*confluenceNode)
	assign = func(siblings []*confluenceNode) {
		taken := map[string]int{}
		for _, node := range siblings {
			slug := wiki.WikiSlug(node.page.Title)
			if slug == "" {
				// A title that reduces to nothing — punctuation, emoji — still
				// has to land somewhere findable, and the page id is the one
				// name it definitely has.
				slug = "page-" + node.page.ID
				node.renamed = true
			}
			if slug != strings.TrimSuffix(node.page.Title, wiki.WikiPageExt) {
				node.renamed = true
			}
			if n, clash := taken[slug]; clash {
				taken[slug] = n + 1
				slug = fmt.Sprintf("%s-%d", slug, n+1)
				node.renamed = true
			} else {
				taken[slug] = 1
			}
			node.slug = slug
			assign(node.children)
		}
	}
	assign(t.roots)
}

// pathFor is where a node's file goes.
//
// A page with children is its folder's index.md, so the folder is labelled by
// prose somebody wrote rather than by a generated list — the rule the specification already
// states for the wiki's own folders, applied to an imported tree.
//
// A title reaching upward is deliberately not repaired: the segment is passed
// through so wiki.ResolveWikiPath refuses it and the import reports it. Repairing it
// here would produce a legal-looking name the write path would then accept,
// which is the one outcome this whole boundary exists to prevent.
func (t *confluenceTree) pathFor(node *confluenceNode, area string) string {
	segments := []string{}
	for cursor := node; cursor != nil; cursor = cursor.parent {
		segments = append([]string{cursor.slug}, segments...)
	}
	if escapes(node.page.Title) {
		// Handed back as the title itself, which is what wiki.WikiImportPath does for
		// the same reason: the write path has to see the escape to refuse it.
		return node.page.Title
	}

	full := append([]string{area}, segments...)
	if len(node.children) > 0 {
		full = append(full, "index")
	}
	return strings.Join(full, "/") + wiki.WikiPageExt
}

// escapes reports whether a title would reach out of the wiki directory.
func escapes(title string) bool {
	normalised := strings.ReplaceAll(strings.TrimSpace(title), "\\", "/")
	if strings.HasPrefix(normalised, "/") {
		return true
	}
	for _, segment := range strings.Split(normalised, "/") {
		if strings.TrimSpace(segment) == ".." {
			return true
		}
	}
	return false
}

// ordered lists every node depth first, parents before children, so a report
// reads in the order somebody walking the tree would see.
func (t *confluenceTree) ordered() []*confluenceNode {
	var out []*confluenceNode
	var walk func(nodes []*confluenceNode)
	walk = func(nodes []*confluenceNode) {
		for _, node := range nodes {
			out = append(out, node)
			walk(node.children)
		}
	}
	walk(t.roots)
	return out
}

// Mirror pushes wiki pages out to a Confluence space, hierarchy included.
//
// Three refusals it makes rather than guessing at: a second target, a page with
// no title, and two pages wanting one title in a space. None of them is repaired
// automatically, because every repair would be a decision about somebody's prose
// that they did not make.
func (s *ConfluenceSource) Mirror(ctx context.Context, pages []wiki.WikiMirrorPage, state *wiki.WikiMirrorState) (wiki.WikiMirrorReport, error) {
	report := wiki.WikiMirrorReport{Target: s.targetName()}
	if s.space == "" {
		return report, fmt.Errorf("a confluence mirror needs a space key — pass --space")
	}

	// The second target, refused rather than silently forgotten.
	//
	// wiki.LoadWikiMirrorState has already replaced a foreign target's state with an
	// empty one by the time Mirror is called — correctly, because foreign
	// digests would make every page look unchanged — so by here a second target
	// is otherwise indistinguishable from a first run. The displaced name it
	// carries out is the only thing that still knows a first target existed.
	if state != nil && state.DisplacedTarget != "" && state.DisplacedTarget != s.targetName() {
		return report, fmt.Errorf("%w: the state records %q, this run targets %q — "+
			"one wiki mirrors to one target, and replacing the state would push every page "+
			"to the first target again on its next run",
			ErrConfluenceOtherTarget, state.DisplacedTarget, s.targetName())
	}
	if state != nil {
		state.Target = s.targetName()
	}

	space, err := s.client.space(ctx, s.space)
	if err != nil {
		return report, err
	}

	// Title collisions are found before anything is pushed, so a run either
	// reports them all or pushes a tree that is half made.
	byTitle := map[string][]string{}
	for _, page := range pages {
		byTitle[page.Title] = append(byTitle[page.Title], page.Path)
	}

	// What the space already holds, so a collision with a page this mirror did
	// not write is refused rather than discovered as a 400 half way through.
	existingTitles, err := s.titlesInSpace(ctx, space.ID)
	if err != nil {
		return report, err
	}

	plan := planConfluenceMirror(pages)
	for _, item := range plan.items {
		page := item.page
		if strings.TrimSpace(page.Title) == "" {
			report.Skipped = append(report.Skipped, page.Path)
			report.Conflicts = append(report.Conflicts, wiki.WikiMirrorConflict{
				Page: page.Path,
				Why:  "the page declares no title; Confluence has nothing to call it",
			})
			continue
		}
		if existing := existingTitles[page.Title]; existing != "" && plan.remoteIDOf(page.Path) == "" {
			if _, known := state.Entry(page.Path); !known {
				// A page the mirror has never pushed, whose title a page in the
				// space already carries. Confluence allows one title per space,
				// so creating it is impossible — and the page over there belongs
				// to somebody else, so adopting it silently would make the next
				// run overwrite a page this mirror never wrote.
				//
				// Found live rather than by fixture: a freshly created space
				// auto-creates a homepage called "<Space Name> Home", so the very
				// first mirror into a new space collided with a page nobody knew
				// was there.
				report.Skipped = append(report.Skipped, page.Path)
				report.Conflicts = append(report.Conflicts, wiki.WikiMirrorConflict{
					Page:     page.Path,
					RemoteID: existing,
					Why: fmt.Sprintf("a page titled %q already exists in %s and this mirror "+
						"did not create it — confluence allows one title per space, and adopting "+
						"a page somebody else wrote would make the next run overwrite it",
						page.Title, s.space),
				})
				continue
			}
		}
		if paths := byTitle[page.Title]; len(paths) > 1 {
			sort.Strings(paths)
			report.Skipped = append(report.Skipped, page.Path)
			report.Conflicts = append(report.Conflicts, wiki.WikiMirrorConflict{
				Page: page.Path,
				Why: fmt.Sprintf("confluence allows one title per space; %s both want %q — "+
					"no suffix is added, because a title is prose somebody wrote",
					strings.Join(paths, " and "), page.Title),
			})
			continue
		}

		parentID := ""
		if item.parent != "" {
			parentID = plan.remoteIDOf(item.parent)
		}
		if err := s.mirrorOne(ctx, space.ID, parentID, page, state, &report, plan); err != nil {
			return report, err
		}
	}
	return report, nil
}

// titlesInSpace maps the titles the space already holds to their page ids.
//
// Read once per run rather than probed per page: a space is one paged listing,
// and asking per page would multiply the call count by the size of the wiki.
func (s *ConfluenceSource) titlesInSpace(ctx context.Context, spaceID string) (map[string]string, error) {
	pages, err := s.client.pagesInSpace(ctx, spaceID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(pages))
	for _, page := range pages {
		out[page.Title] = page.ID
	}
	return out, nil
}

// targetName is what the state file records: the source and the space, so a
// state file cannot be read as being about a different space of the same
// instance. That is what makes the second-target refusal able to fire at all.
func (s *ConfluenceSource) targetName() string {
	if s.space == "" {
		return ConfluenceSourceName
	}
	return ConfluenceSourceName + ":" + s.space
}

// mirrorOne pushes one page, or refuses it.
func (s *ConfluenceSource) mirrorOne(ctx context.Context, spaceID, parentID string, page wiki.WikiMirrorPage, state *wiki.WikiMirrorState, report *wiki.WikiMirrorReport, plan *confluencePlan) error {
	// page.Body is the prose by contract; MarkdownToConfluenceWithEmbeds strips
	// a header anyway, so a caller that has not been updated cannot push one.
	storage, embeds, err := MarkdownToConfluenceWithEmbeds(page.Body, page.Address)
	if err != nil {
		return fmt.Errorf("%s: %w", page.Path, err)
	}
	// Named in the report, exactly as a macro is in the other direction. A page
	// can go out looking complete while the live view it was written around did
	// not, and a report that only counted pushes would never say so.
	report.EmbedLosses = append(report.EmbedLosses, ConfluenceEmbedLosses(page.Path, embeds)...)

	last, known := state.Entry(page.Path)
	if !known {
		created, err := s.client.createPage(ctx, spaceID, parentID, page.Title, storage)
		if err != nil {
			return fmt.Errorf("%s: %w", page.Path, err)
		}
		state.Record(page.Path, wiki.WikiMirrorEntry{
			Digest:       page.Digest,
			RemoteID:     created.ID,
			RemoteDigest: RemoteDigestOf(created.Version.Number),
		})
		plan.record(page.Path, created.ID)
		report.Pushed = append(report.Pushed, page.Path)
		return nil
	}

	current, err := s.client.page(ctx, last.RemoteID)
	if err != nil {
		var httpErr *confluenceHTTPError
		if errors.As(err, &httpErr) && httpErr.NotFound() {
			// Somebody deleted it over there. The mirror does not put it back:
			// re-creating a page somebody removed undoes their decision, and a
			// tool that does that in a foreign system is the one mistake nobody
			// can undo.
			report.Skipped = append(report.Skipped, page.Path)
			report.Conflicts = append(report.Conflicts, wiki.WikiMirrorConflict{
				Page:     page.Path,
				RemoteID: last.RemoteID,
				Why: "the Confluence page is absent (404) — it is not re-created, because " +
					"somebody removed it and the mirror does not undo that; remove its entry " +
					"from .mirror.json to have the next run create it anew",
			})
			return nil
		}
		return fmt.Errorf("%s: %w", page.Path, err)
	}
	plan.record(page.Path, current.ID)

	remoteNow := RemoteDigestOf(current.Version.Number)
	if remoteNow != last.RemoteDigest {
		// Detect, refuse, report. Both identifiers are named so a person can
		// open both sides.
		report.Conflicts = append(report.Conflicts, wiki.WikiMirrorConflict{
			Page:     page.Path,
			RemoteID: current.ID,
			Why: fmt.Sprintf("changed in Confluence since the last run (version %d, "+
				"last pushed at %s) — not overwritten", current.Version.Number, last.RemoteDigest),
		})
		return nil
	}
	if last.Digest == page.Digest {
		report.Unchanged = append(report.Unchanged, page.Path)
		return nil
	}

	updated, err := s.client.updatePage(ctx, current.ID, page.Title, storage, current.Version.Number+1)
	if err != nil {
		return fmt.Errorf("%s: %w", page.Path, err)
	}
	state.Record(page.Path, wiki.WikiMirrorEntry{
		Digest:       page.Digest,
		RemoteID:     updated.ID,
		RemoteDigest: RemoteDigestOf(updated.Version.Number),
	})
	report.Pushed = append(report.Pushed, page.Path)
	return nil
}

// confluencePlanItem is one page to push and where it sits.
type confluencePlanItem struct {
	page wiki.WikiMirrorPage
	// parent is the wiki path of the page that becomes this one's parent in
	// Confluence, empty for a page at the top of its area.
	parent string
}

// confluencePlan is the push order, plus the remote ids learned along the way.
//
// The id table belongs to the plan rather than to the package: two mirror runs
// in one process — two registries of a monorepo, or a test — would otherwise
// share one map, and a page would be hung under a parent from somebody else's
// run. A struct rather than a slice for exactly that reason.
type confluencePlan struct {
	items []*confluencePlanItem
	// remoteIDs is where a parent's Confluence id is looked up once it exists.
	remoteIDs map[string]string
}

func (p *confluencePlan) record(path, id string) { p.remoteIDs[path] = id }

func (p *confluencePlan) remoteIDOf(path string) string { return p.remoteIDs[path] }

// planConfluenceMirror decides what becomes whose child, and in what order.
//
// Parents before children, so a child always has an id to hang from. The tree is
// read off the file paths — an area's index.md is the area's parent page, a
// folder's index.md is that folder's — which is the wiki's own rule about what an
// index page is, applied to the far side.
//
// An area with no index.md gets no invented parent here: its pages hang at the
// top of the space. Creating a placeholder page would be this tool writing prose
// nobody wrote into somebody's Confluence.
func planConfluenceMirror(pages []wiki.WikiMirrorPage) *confluencePlan {
	byFolder := map[string]string{}
	for _, page := range pages {
		if isIndexPath(page.Path) {
			byFolder[folderOf(page.Path)] = page.Path
		}
	}

	plan := &confluencePlan{remoteIDs: map[string]string{}}
	for i := range pages {
		page := pages[i]
		item := &confluencePlanItem{page: page}
		folder := folderOf(page.Path)
		if isIndexPath(page.Path) {
			// An index page's parent is the index page of the folder above it.
			if parentFolder, ok := parentFolderOf(folder); ok {
				item.parent = byFolder[parentFolder]
			}
		} else if index, ok := byFolder[folder]; ok {
			item.parent = index
		}
		plan.items = append(plan.items, item)
	}

	// Parents first: an item whose parent is in the plan must come after it.
	sort.SliceStable(plan.items, func(i, j int) bool {
		return depthOfPath(plan.items[i].page.Path) < depthOfPath(plan.items[j].page.Path)
	})
	return plan
}

func isIndexPath(rel string) bool {
	return strings.HasSuffix(rel, "/index"+wiki.WikiPageExt) || rel == "index"+wiki.WikiPageExt
}

func folderOf(rel string) string {
	if i := strings.LastIndex(rel, "/"); i > 0 {
		return rel[:i]
	}
	return ""
}

func parentFolderOf(folder string) (string, bool) {
	if i := strings.LastIndex(folder, "/"); i > 0 {
		return folder[:i], true
	}
	return "", false
}

// depthOfPath sorts an index page above its siblings so a parent is created
// before the children that name it.
func depthOfPath(rel string) int {
	depth := strings.Count(rel, "/") * 2
	if isIndexPath(rel) {
		depth--
	}
	return depth
}

// Reach makes exactly ONE request and reports the status it got.
//
// The measurement the setup surface's state line rests on, and the count is
// part of the promise: "Check now" makes one request, so this makes one.
// A spaces query with limit 1 is the cheapest thing that proves the whole path
// — the URL resolves, TLS stands, the credential is accepted — without reading
// anybody's content.
//
// The return shape is the point. A refusal comes back as (401, err): the
// request went out, an answer came back, it said no. No answer at all comes
// back as (0, err). A caller can therefore tell "answered no" from "did not
// answer" without reading a message, which is the distinction the state line
// makes and which a single error value would have thrown away.
func (s *ConfluenceSource) Reach(ctx context.Context) (int, error) {
	var list confluenceList[confluenceSpace]
	err := s.client.do(ctx, "GET", "/wiki/api/v2/spaces?limit=1", nil, &list)
	if err == nil {
		return 200, nil
	}
	var httpErr *confluenceHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.Status, err
	}
	return 0, err
}
