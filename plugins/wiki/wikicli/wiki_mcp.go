package wikicli

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"

	facetwiki "github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
	"github.com/facet-framework/core/registry"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The wiki's agent surface.
//
//
// Eleven tools rather than the specification's four, and the difference is a decision about
// what an agent is for. Four tools let an agent write a page; they do not let
// it *lead* a wiki. Adding a tag through a whole-page write discards whatever
// somebody wrote in the body meanwhile; renaming is not expressible at all; and
// linking a record means resending the entire file to change one list. So the
// floor is four and this is what stands on it: find, get, create, write, four
// field edits, move, commit, propose.
//
// Every one of them calls internal/facet's write path. That is the security
// argument rather than an economy: the specification says the MCP tools "call the code of the
// HTTP routes", because a tool that could do more by arriving from another
// direction would be a second door into the same room — and the six refusals
// would then hold only on whichever door somebody remembered to lock.
//
// Three limits are kept from the specification, and each is a rule rather than a gap:
//
//  1. No tool writes a .yaml. ResolveWikiPath refuses it, so an agent cannot
//     turn prose into a normative promise by writing the right file.
//  2. No tool pushes to the default branch and none merges. Everything arrives
//     as a proposal, which is the rule that makes the rest bearable.
//  3. No tool deletes. Removing a page is a person's 'git rm'. An agent able to
//     delete documentation that is in its way is a bad trade for a small
//     convenience — and a rename, which is what an agent usually means, is
//     offered instead.
//

type authoringSessionKey struct {
	root    string
	records string
	branch  string
}

// wikiToolState owns authoring sessions for one MCP server. A branch is
// scoped to its repository and records directory, never shared across registries.
type wikiToolState struct {
	mu sync.Mutex
	by map[authoringSessionKey]*wikiAgentSession
}

func newWikiToolState() *wikiToolState {
	return &wikiToolState{by: make(map[authoringSessionKey]*wikiAgentSession)}
}

// wikiAgentSession is one open branch and what the host wrote on it.
//
// The written list is why this is remembered: refusal 4 stages what the host
// itself wrote, and the only way to know that is to have kept the list.
type wikiAgentSession struct {
	mu      sync.Mutex
	session *facetwiki.WikiSession
	written []string
}

func (state *wikiToolState) wikiSessionFor(reg facet.Registry, branch string) (*wikiAgentSession, error) {
	state.mu.Lock()
	defer state.mu.Unlock()
	key := authoringSessionKey{root: filepath.Clean(reg.Root), records: filepath.Clean(reg.RecordsDir), branch: strings.TrimSpace(branch)}
	if s, ok := state.by[key]; ok {
		return s, nil
	}
	session, err := facetwiki.OpenWikiBranch(reg, branch)
	if err != nil {
		return nil, err
	}
	s := &wikiAgentSession{session: session}
	state.by[key] = s
	return s, nil
}

// rememberWritten is called while the session operation lock is held.
func (s *wikiAgentSession) rememberWritten(paths ...string) {
	for _, path := range paths {
		found := false
		for _, existing := range s.written {
			if existing == path {
				found = true
				break
			}
		}
		if !found {
			s.written = append(s.written, path)
		}
	}
}

// --- tool inputs and outputs -------------------------------------------------

type wikiFindInput struct {
	Query    string `json:"query" jsonschema:"text matched against a page's title, summary, tags and address"`
	Mode     string `json:"mode,omitempty" jsonschema:"lexical (default), by_area, by_category, by_tag, or by_record"`
	Registry string `json:"registry,omitempty" jsonschema:"which registry's wiki, in a repository declaring several"`
	Limit    int    `json:"limit,omitempty" jsonschema:"maximum results, default 25"`
}

type wikiFindOutput struct {
	Matches []facetwiki.WikiPageList `json:"matches"`
	Total   int                      `json:"total"`
}

type wikiGetInput struct {
	Path     string `json:"path" jsonschema:"exact page path under the wiki directory, such as onboarding/first-day.md"`
	Registry string `json:"registry,omitempty"`
}

// wikiGetOutput is a page as an agent receives it.
//
// Header and body are separate because an agent editing one must not have to
// re-emit the other. The digest is included so a later edit can state what it
// read: an agent that works from a stale read would otherwise overwrite whoever
// wrote in between.
type wikiGetOutput struct {
	Path    string `json:"path"`
	Address string `json:"address"`
	Area    string `json:"area"`
	Title   string `json:"title"`
	// Category, Status and Reviewed are what the page says, empty included.
	// Empty is the answer "nobody said", and it is passed through as empty so
	// an agent summarising the wiki cannot report a page as maintained merely
	// because nobody said it was not.
	Category string   `json:"category,omitempty"`
	Status   string   `json:"status,omitempty"`
	Reviewed string   `json:"reviewed,omitempty"`
	Summary  string   `json:"summary,omitempty"`
	Tags     []string `json:"tags,omitempty"`
	Records  []string `json:"records,omitempty"`
	Body     string   `json:"body"`
	Digest   string   `json:"digest"`
	// TooDeep reports that the page lies past the wiki's declared depth. Said
	// rather than silently tolerated, because an agent creating a sibling
	// should know it is about to make the problem bigger.
	TooDeep bool `json:"tooDeep,omitempty"`
}

type wikiWriteInput struct {
	Branch   string `json:"branch" jsonschema:"the branch to write on; it is created with its own worktree, and may never be the default branch"`
	Path     string `json:"path" jsonschema:"page path under the wiki directory; must end in .md and every segment must match [a-z][a-z0-9-]*"`
	Body     string `json:"body" jsonschema:"the page's Markdown, including its --- front matter"`
	IfMatch  string `json:"ifMatch,omitempty" jsonschema:"the digest wiki_get returned; the write is refused if the page changed since"`
	Registry string `json:"registry,omitempty"`
}

// wikiWriteOutput answers with the diff rather than with a confirmation.
//
// the specification requires it: "write tools produce proposed diffs, not direct mutations."
// A caller that can show the diff is a caller whose user can refuse it, and
// "written successfully" is the one answer that cannot be reviewed.
type wikiWriteOutput struct {
	Path   string `json:"path"`
	Diff   string `json:"diff"`
	Digest string `json:"digest"`
	Branch string `json:"branch"`
}

type wikiEditInput struct {
	Branch string `json:"branch"`
	Path   string `json:"path"`
	// The field edits. Each is optional and absent means "leave alone", which
	// is what makes this safe to run against a page somebody else is editing:
	// the body and every unnamed field are written back byte for byte.
	AddTags       []string `json:"addTags,omitempty" jsonschema:"tags to add, appended in the order given"`
	RemoveTags    []string `json:"removeTags,omitempty"`
	AddRecords    []string `json:"addRecords,omitempty" jsonschema:"record ids this page is about; an id no registry holds is an error in facet wiki check"`
	RemoveRecords []string `json:"removeRecords,omitempty"`
	Category      *string  `json:"category,omitempty" jsonschema:"the page's category; empty string clears it"`
	Status        *string  `json:"status,omitempty" jsonschema:"draft, maintained or outdated; empty string clears it back to 'nobody said'"`
	Title         *string  `json:"title,omitempty"`
	Summary       *string  `json:"summary,omitempty"`
	IfMatch       string   `json:"ifMatch,omitempty"`
	Registry      string   `json:"registry,omitempty"`
}

type wikiMoveInput struct {
	Branch   string `json:"branch"`
	From     string `json:"from"`
	To       string `json:"to"`
	Registry string `json:"registry,omitempty"`
}

// wikiMoveOutput names both addresses, because the path is the address.
//
// A rename changes where a page is reached and nothing stores a redirect, so a
// tool that did not say so would leave somebody to discover it from a dead
// link.
type wikiMoveOutput struct {
	From        string `json:"from"`
	To          string `json:"to"`
	FromAddress string `json:"fromAddress"`
	ToAddress   string `json:"toAddress"`
	Note        string `json:"note"`
}

type wikiCommitInput struct {
	Branch   string `json:"branch"`
	Message  string `json:"message" jsonschema:"the commit message"`
	Registry string `json:"registry,omitempty"`
}

type wikiProposeInput struct {
	Branch   string `json:"branch"`
	Title    string `json:"title" jsonschema:"the pull request's title"`
	Body     string `json:"body,omitempty"`
	Registry string `json:"registry,omitempty"`
}

type wikiProposeOutput struct {
	Branch      string `json:"branch"`
	Pushed      bool   `json:"pushed"`
	PullRequest bool   `json:"pullRequest"`
	URL         string `json:"url,omitempty"`
	// Message says what happened when something did not. A forge this host
	// cannot open a pull request on, or a push the remote refused, loses the
	// last step and nothing else — and is said rather than swallowed.
	Message string `json:"message,omitempty"`
}

type wikiCheckInput struct {
	Strict   bool   `json:"strict,omitempty" jsonschema:"treat every warning as an error"`
	Registry string `json:"registry,omitempty"`
}

// --- registration ------------------------------------------------------------

// addWikiTools registers the wiki surface on an MCP server.
func addWikiTools(server *mcp.Server, set facet.RegistrySet) *wikiToolState {
	state := newWikiToolState()
	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_find",
		Description: "Search the project's wiki — the prose beside the registry. Returns each page's path, address, area, category and tags. Modes: lexical (default), by_area, by_category, by_tag, by_record. A page's status comes back exactly as the page states it, empty included: empty means nobody has explained the page's state, never that it is maintained.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiFindInput) (*mcp.CallToolResult, wikiFindOutput, error) {
		out, err := wikiFind(set, in)
		return nil, out, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_get",
		Description: "Read one wiki page by its exact path, returning its header fields, its Markdown body and a digest. Pass the digest back as ifMatch when you later write or edit, so a page somebody changed in between is refused rather than overwritten. An unknown path is an error — use wiki_find to discover pages.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiGetInput) (*mcp.CallToolResult, wikiGetOutput, error) {
		out, err := wikiGet(set, in)
		return nil, out, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_create",
		Description: "Create a new wiki page on a branch, refusing to replace one that already exists — use wiki_write to replace deliberately. Returns the diff. REFUSES: any path outside the wiki directory (judged after symlinks are resolved), any filename outside [a-z][a-z0-9-]*.md, any .yaml at all (a record, taxonomy.yaml, glossary.yaml, wiki.yaml), and the repository's default branch.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiWriteInput) (*mcp.CallToolResult, wikiWriteOutput, error) {
		out, err := state.wikiWriteTool(set, in, true)
		return nil, out, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_write",
		Description: "Write a wiki page on a branch, creating or replacing it, and return the diff rather than a confirmation. Prefer wiki_set_tags / wiki_set_category / wiki_set_records / wiki_set_status for changing one header field: they leave the body and every other field byte-identical, where a full write discards whatever somebody wrote beside it. REFUSES the same five things wiki_create refuses.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiWriteInput) (*mcp.CallToolResult, wikiWriteOutput, error) {
		out, err := state.wikiWriteTool(set, in, false)
		return nil, out, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_set_tags",
		Description: "Add and remove a page's tags without rewriting the page. The body and every other header field are written back byte for byte, so this is safe against a page somebody is editing. Removing the last tag removes the key, because absent is what 'no tags' means in this header. Returns the diff.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiEditInput) (*mcp.CallToolResult, wikiWriteOutput, error) {
		out, err := state.wikiEditTool(set, in, facetwiki.WikiFrontEdit{AddTags: in.AddTags, RemoveTags: in.RemoveTags})
		return nil, out, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_set_category",
		Description: "Set or clear a page's category, leaving everything else byte-identical. The category must be one wiki.yaml declares; naming an undeclared one is a warning in 'facet wiki check' rather than a refusal here, because declaring it may simply be the next step. Clearing it is allowed and means nobody has classified the page — never a category called 'Other'.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiEditInput) (*mcp.CallToolResult, wikiWriteOutput, error) {
		out, err := state.wikiEditTool(set, in, facetwiki.WikiFrontEdit{Category: in.Category})
		return nil, out, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_set_records",
		Description: "Link and unlink the record ids a page is about, leaving everything else byte-identical. An id no registry holds is an ERROR in 'facet wiki check' — the same treatment an @facet: tag naming no record gets — so check the id with feature_get first. This is the only direction the link exists in: a record never names a page.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiEditInput) (*mcp.CallToolResult, wikiWriteOutput, error) {
		out, err := state.wikiEditTool(set, in, facetwiki.WikiFrontEdit{AddRecords: in.AddRecords, RemoveRecords: in.RemoveRecords})
		return nil, out, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_set_status",
		Description: "Set or clear a page's status (draft, maintained, outdated), title or summary, leaving everything else byte-identical. Do NOT set 'reviewed' here and there is no parameter for it: that date says a person confirmed the content, and an agent writing it would be stating a fact nobody established.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiEditInput) (*mcp.CallToolResult, wikiWriteOutput, error) {
		out, err := state.wikiEditTool(set, in, facetwiki.WikiFrontEdit{Status: in.Status, Title: in.Title, Summary: in.Summary})
		return nil, out, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_move",
		Description: "Rename a page or move it to another area or group. The path IS the address, so this changes where the page is reached and no redirect is stored — the answer names both addresses, and links to the old one go visibly dead. Moving into another folder moves the page into another area, which is what moving a file means. There is deliberately NO delete tool: removing a page is a person's 'git rm'.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiMoveInput) (*mcp.CallToolResult, wikiMoveOutput, error) {
		out, err := state.wikiMoveTool(set, in)
		return nil, out, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_commit",
		Description: "Commit exactly the pages written on this branch so far. The paths come from what the host recorded writing, never from this call, so nothing else in the worktree can be staged — there is no 'git add -A' and no way to name a path here. The working tree you are coding in is never touched: all of this happens in a separate worktree under .git/.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiCommitInput) (*mcp.CallToolResult, facetwiki.WikiCommit, error) {
		out, err := state.wikiCommitTool(set, in)
		return nil, out, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_propose",
		Description: "Push the branch and open a pull request for it. This is the only way an agent's wiki work reaches anybody: there is no tool that pushes to the default branch and none that merges — a person merges. If no forge is declared for the remote's host, or a forge CLI is missing, the branch is still pushed and the answer says what is left to do by hand. A self-hosted GitLab or GitHub Enterprise is named under 'forges:' in .facetrc.yaml; only github.com and gitlab.com are recognised without one, because a hostname does not say what runs behind it.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiProposeInput) (*mcp.CallToolResult, wikiProposeOutput, error) {
		out, err := state.wikiProposeTool(set, in)
		return nil, out, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "wiki_check",
		Description: "Run the wiki's own checks and return the findings: a page with no title and a record id naming nothing are errors, and an undeclared area, unknown category, excessive depth, dead atlas: reference or an embedding carrying a value are warnings. Run it before wiki_propose, so a proposal arrives without the findings a reviewer would otherwise have to report.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in wikiCheckInput) (*mcp.CallToolResult, facetwiki.WikiReport, error) {
		out, err := wikiCheckTool(set, in)
		return nil, out, err
	})
	return state
}

// --- implementations ---------------------------------------------------------

// wikiRegistryFor picks which registry's wiki a call means.
func wikiRegistryFor(set facet.RegistrySet, name string) (facet.Registry, error) {
	if name == "" {
		return set.Primary(), nil
	}
	for _, reg := range set {
		if reg.Name == name {
			return reg, nil
		}
	}
	return facet.Registry{}, fmt.Errorf("no registry named %q", name)
}

func wikiFind(set facet.RegistrySet, in wikiFindInput) (wikiFindOutput, error) {
	reg, err := wikiRegistryFor(set, in.Registry)
	if err != nil {
		return wikiFindOutput{}, err
	}
	wiki, err := facetwiki.LoadWiki(facetwiki.WikiDir(reg))
	if err != nil {
		return wikiFindOutput{}, err
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 25
	}
	q := strings.ToLower(strings.TrimSpace(in.Query))

	out := wikiFindOutput{Matches: []facetwiki.WikiPageList{}}
	for _, page := range facetwiki.ListWikiPages(wiki, "", "", "") {
		if !wikiMatches(page, q, in.Mode) {
			continue
		}
		out.Total++
		if len(out.Matches) < limit {
			out.Matches = append(out.Matches, page)
		}
	}
	return out, nil
}

func wikiMatches(page facetwiki.WikiPageList, q, mode string) bool {
	if q == "" {
		return true
	}
	switch mode {
	case "by_area", "by_bereich":
		return strings.EqualFold(page.Area, q)
	case "by_category", "by_kategorie":
		return strings.EqualFold(page.Category, q)
	case "by_tag":
		for _, t := range page.Tags {
			if strings.EqualFold(t, q) {
				return true
			}
		}
		return false
	case "by_record":
		for _, id := range page.Records {
			if strings.EqualFold(id, q) {
				return true
			}
		}
		return false
	default:
		haystack := strings.ToLower(page.Title + " " + page.Summary + " " + page.Path + " " + strings.Join(page.Tags, " "))
		return strings.Contains(haystack, q)
	}
}

func wikiGet(set facet.RegistrySet, in wikiGetInput) (wikiGetOutput, error) {
	reg, err := wikiRegistryFor(set, in.Registry)
	if err != nil {
		return wikiGetOutput{}, err
	}
	wiki, err := facetwiki.LoadWiki(facetwiki.WikiDir(reg))
	if err != nil {
		return wikiGetOutput{}, err
	}
	page, ok := wiki.Page(strings.TrimSpace(in.Path))
	if !ok {
		// Exact matching with no fuzzy fallback (the specification): a near miss answered
		// confidently is the failure mode the whole tool surface exists to
		// prevent.
		return wikiGetOutput{}, fmt.Errorf("no page at %q — use wiki_find to discover pages", in.Path)
	}
	return wikiGetOutput{
		Path:     page.Path,
		Address:  page.Address(),
		Area:     page.Area(),
		Title:    page.Front.Title,
		Category: page.Front.Category,
		Status:   page.Front.Status,
		Reviewed: page.Front.Reviewed,
		Summary:  page.Front.Summary,
		Tags:     page.Front.Tags,
		Records:  page.Front.Records,
		Body:     page.Body,
		Digest:   page.Digest(),
		TooDeep:  wiki.TooDeep(page.Path),
	}, nil
}

// wikiWriteTool is wiki_create and wiki_write, which differ only in whether an
// existing page is replaced.
func (state *wikiToolState) wikiWriteTool(set facet.RegistrySet, in wikiWriteInput, mustBeNew bool) (wikiWriteOutput, error) {
	reg, err := wikiRegistryFor(set, in.Registry)
	if err != nil {
		return wikiWriteOutput{}, err
	}
	session, err := state.wikiSessionFor(reg, in.Branch)
	if err != nil {
		return wikiWriteOutput{}, err
	}
	session.mu.Lock()
	defer session.mu.Unlock()

	before := wikiCurrentBody(session.session.WikiDir, in.Path)
	if in.IfMatch != "" && before != "" && facetwiki.WikiDigest(before) != in.IfMatch {
		return wikiWriteOutput{}, fmt.Errorf("%w: %s", facetwiki.ErrWikiStale, in.Path)
	}

	var written string
	if mustBeNew {
		written, err = facetwiki.CreateWikiPage(reg, session.session.WikiDir, in.Path, in.Body)
	} else {
		written, err = facetwiki.WriteWikiPage(reg, session.session.WikiDir, in.Path, in.Body)
	}
	if err != nil {
		return wikiWriteOutput{}, err
	}
	session.rememberWritten(written)
	return wikiWriteOutput{
		Path:   written,
		Diff:   facet.UnifiedDiff(written, before, in.Body),
		Digest: facetwiki.WikiDigest(in.Body),
		Branch: session.session.Branch,
	}, nil
}

// wikiEditTool is the four field edits, which differ only in which fields they
// pass through.
func (state *wikiToolState) wikiEditTool(set facet.RegistrySet, in wikiEditInput, edit facetwiki.WikiFrontEdit) (wikiWriteOutput, error) {
	reg, err := wikiRegistryFor(set, in.Registry)
	if err != nil {
		return wikiWriteOutput{}, err
	}
	session, err := state.wikiSessionFor(reg, in.Branch)
	if err != nil {
		return wikiWriteOutput{}, err
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	edit.IfMatch = in.IfMatch

	edited, err := facetwiki.EditWikiFront(reg, session.session.WikiDir, in.Path, edit)
	if err != nil {
		return wikiWriteOutput{}, err
	}
	session.rememberWritten(edited.Path)
	return wikiWriteOutput{
		Path:   edited.Path,
		Diff:   edited.Diff,
		Digest: edited.Digest,
		Branch: session.session.Branch,
	}, nil
}

func (state *wikiToolState) wikiMoveTool(set facet.RegistrySet, in wikiMoveInput) (wikiMoveOutput, error) {
	reg, err := wikiRegistryFor(set, in.Registry)
	if err != nil {
		return wikiMoveOutput{}, err
	}
	session, err := state.wikiSessionFor(reg, in.Branch)
	if err != nil {
		return wikiMoveOutput{}, err
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	moved, err := facetwiki.MoveWikiPage(reg, session.session.WikiDir, in.From, in.To)
	if err != nil {
		return wikiMoveOutput{}, err
	}
	// Both halves are staged, or the commit would add the new file and leave
	// the old one behind as an untracked deletion nobody committed.
	session.rememberWritten(moved.From, moved.To)
	return wikiMoveOutput{
		From:        moved.From,
		To:          moved.To,
		FromAddress: moved.FromAddress,
		ToAddress:   moved.ToAddress,
		Note:        "the address changed and nothing redirects: links to " + moved.FromAddress + " resolve as visibly dead, which 'facet wiki check' reports as a warning",
	}, nil
}

func (state *wikiToolState) wikiCommitTool(set facet.RegistrySet, in wikiCommitInput) (facetwiki.WikiCommit, error) {
	reg, err := wikiRegistryFor(set, in.Registry)
	if err != nil {
		return facetwiki.WikiCommit{}, err
	}
	session, err := state.wikiSessionFor(reg, in.Branch)
	if err != nil {
		return facetwiki.WikiCommit{}, err
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	// The paths are the host's own record of what it wrote. There is no
	// parameter for them, which is how refusal 4 is kept structurally rather
	// than checked: a caller cannot name a path, so it cannot name one the host
	// did not write.
	return session.session.Commit(in.Message, session.written)
}

func (state *wikiToolState) wikiProposeTool(set facet.RegistrySet, in wikiProposeInput) (wikiProposeOutput, error) {
	reg, err := wikiRegistryFor(set, in.Registry)
	if err != nil {
		return wikiProposeOutput{}, err
	}
	session, err := state.wikiSessionFor(reg, in.Branch)
	if err != nil {
		return wikiProposeOutput{}, err
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	out := wikiProposeOutput{Branch: session.session.Branch}
	if err := session.session.Push(""); err != nil {
		// Never rolled back: the commit is somebody's writing, and undoing it
		// because a remote refused would throw that writing away.
		out.Message = err.Error() + " — the branch and the commit are here; push them by hand"
		return out, nil
	}
	out.Pushed = true

	gitState := facetwiki.WikiGitState(reg)
	url, err := facetwiki.OpenWikiPullRequest(session.session, gitState, in.Title, in.Body)
	if err != nil {
		out.Message = err.Error()
		return out, nil
	}
	out.PullRequest, out.URL = true, url
	return out, nil
}

func wikiCheckTool(set facet.RegistrySet, in wikiCheckInput) (facetwiki.WikiReport, error) {
	reg, err := wikiRegistryFor(set, in.Registry)
	if err != nil {
		return facetwiki.WikiReport{}, err
	}
	known := map[string]bool{}
	for _, r := range set {
		if recs, err := r.LoadFeatures(); err == nil {
			for _, rec := range recs {
				known[rec.ID] = true
			}
		}
	}
	return facetwiki.CheckWiki(reg, facetwiki.WikiCheckOptions{Strict: in.Strict, KnownIDs: known})
}

// wikiCurrentBody reads a page as it stands, for the diff.
//
// An absent page reads as the empty string, which makes a create's diff the
// whole file — correct, because that is what the change is. An unreadable one
// reads the same way, and the write that follows will fail on its own terms
// rather than here.
func wikiCurrentBody(wikiDir, rel string) string {
	abs, err := facetwiki.ResolveWikiPath(wikiDir, rel)
	if err != nil {
		return ""
	}
	data, err := readFileString(abs)
	if err != nil {
		return ""
	}
	return data
}
