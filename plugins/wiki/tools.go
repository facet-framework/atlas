package wiki

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
	"github.com/facet-framework/core/registry"
)

// repoSessions holds the open write sessions of this process, by branch.
//
// In memory rather than on disk, and per process: a session is a worktree plus
// the paths written into it, and both belong to the server process. A stale session
// recorded on disk would send the next run's commit at a worktree that is no
// longer there.
type repoSessions struct {
	mu sync.Mutex
	by map[string]*repoSessionState
}

// repoSessionState is one open session and what the host wrote in it.
//
// The written set is the whole reason this is remembered rather than
// recomputed: refusal 4 says the commit stages what the host itself wrote, and
// the only way to know that is to have kept the list. Asking the worktree what
// changed would stage whatever else is in it, which is the failure the refusal
// names.
type repoSessionState struct {
	session *wiki.WikiSession
	written []string
}

func (w *repoSessions) get(branch string) (*repoSessionState, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	state, ok := w.by[branch]
	return state, ok
}

func (w *repoSessions) put(branch string, state *repoSessionState) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.by == nil {
		w.by = map[string]*repoSessionState{}
	}
	w.by[branch] = state
}

// drop forgets a session and returns it, so its worktree can be removed.
func (w *repoSessions) drop(branch string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.by, branch)
}

// wrote records a path the host wrote on a branch, without repeating one.
func (w *repoSessions) wrote(branch, path string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	state, ok := w.by[branch]
	if !ok {
		return
	}
	for _, existing := range state.written {
		if existing == path {
			return
		}
	}
	state.written = append(state.written, path)
}

// repoSessions returns this server's session store, making one on first use.
func (s *Service) repoSessions() *repoSessions { return &s.sessions }

// hostRepoState answers what the host found, before anything is offered.
//
// This tool exists for the reason the companion's state route does, and says
// so there: asked once when the window opens, so the sign-in notice arrives
// before the question rather than after it. The write path needs more of that
// courtesy, not less — without it the first obstacle is discovered after
// somebody has written a page.
func (s *Service) hostRepoState(args json.RawMessage) (any, error) {
	return wiki.WikiGitState(s.Registry), nil
}

// hostRepoLog answers the git history of one wiki page. Read-only, in the
// manner of repo.state: it needs no session and writes nothing.
func (s *Service) hostRepoLog(args json.RawMessage) (any, error) {
	var req struct {
		Path string `json:"path"`
	}
	if err := decodeArgs(args, &req); err != nil {
		return nil, err
	}
	return wiki.WikiPageLog(s.Registry, req.Path)
}

// wikiPageRequest is a write.
type wikiPageRequest struct {
	Branch string `json:"branch"`
	Path   string `json:"path"`
	Body   string `json:"body"`
	// Front asks the host to render the header from fields instead of taking
	// one already written.
	//
	// It exists because the quoting rule belongs here and cannot be honoured
	// anywhere else. wikiScalar quotes exactly the values a bare reading would
	// change — a colon, a '#', a reserved word like 'true' — and a caller that
	// hands over finished YAML never reaches it. A browser doing that writes
	// 'title: Onboarding: Day 1', which does not parse, and 'title: What is
	// #facet?', which parses to "What is" and loses the rest in silence.
	//
	// So the alternative is offered rather than the rule re-implemented in
	// TypeScript: two implementations of one rule are two chances to get it
	// wrong, and only one of them is tested here.
	Front *wikiFrontRequest `json:"front,omitempty"`
	// EditBody replaces only the prose of a page that already exists. The head
	// (the front matter) is carried over byte for byte from the file in the
	// session's worktree, so keys the surface never offers (reviewed, aliases,
	// mirror) and the author's own formatting survive an edit. Rendering the
	// head again from fields would lose them. Mutually exclusive with Body and
	// Front, and the page must exist.
	EditBody *string `json:"editBody,omitempty"`
	// IfMatch is the digest the browser last read, so a page somebody else
	// changed meanwhile is refused rather than overwritten.
	IfMatch string `json:"ifMatch,omitempty"`
}

// wikiFrontRequest is a header as fields, in the caller's own values.
//
// Deliberately not every key of the specification. 'reviewed' is absent and has no
// parameter, for the reason the agent tools give: that date says a person
// confirmed the content, and a surface writing it would state a fact nobody
// established. 'aliases' and 'mirror' are absent because only the importer and
// the mirror set them.
type wikiFrontRequest struct {
	Title    string   `json:"title"`
	Category string   `json:"category,omitempty"`
	Summary  string   `json:"summary,omitempty"`
	Status   string   `json:"status,omitempty"`
	Tags     []string `json:"tags,omitempty"`
	Records  []string `json:"records,omitempty"`
	// Body is the prose under the header, empty for a new page's scaffold.
	Body string `json:"body,omitempty"`
}

// hostRepoWrite writes one page into an open session's worktree.
//
// Never into the working tree, and there is no parameter that could make it so:
// the destination is the session's own wiki directory, and a request that names
// no open session is refused rather than falling back to the repository.
func (s *Service) hostRepoWrite(args json.RawMessage) (any, error) {
	var req wikiPageRequest
	if err := decodeArgs(args, &req); err != nil {
		return nil, err
	}
	state, ok := s.repoSessions().get(req.Branch)
	if !ok {
		// Falling back to the working tree here would undo the specification in one line.
		return nil, fmt.Errorf("open a branch before writing a page")
	}
	if req.EditBody != nil {
		if req.Body != "" || req.Front != nil {
			return nil, fmt.Errorf("a write names either an edited body, a rendered body or the header fields, not several")
		}
		edited, err := replaceWikiBody(state.session.WikiDir, req.Path, *req.EditBody)
		if err != nil {
			return nil, err
		}
		req.Body = edited
		if req.IfMatch == "" {
			// An edit without the digest of what was read would overwrite a
			// change somebody else made meanwhile.
			return nil, fmt.Errorf("an edit names the digest of the page it read (ifMatch)")
		}
	} else if req.Front != nil {
		if req.Body != "" {
			// Both is not a request with a sensible reading: one of the two is
			// what lands on disk, and guessing which would make the answer
			// depend on the order this function happens to check them in.
			return nil, fmt.Errorf("a write names either a rendered body or the header fields, not both")
		}
		if strings.TrimSpace(req.Front.Title) == "" {
			// The one mandatory key of the specification. Refused here rather than written
			// empty, because a page whose title nobody wrote is a finding
			// 'facet wiki check' reports as an error, and producing one on
			// purpose would be this tool manufacturing that finding.
			return nil, fmt.Errorf("a page needs a title — it is the one key the specification makes mandatory")
		}
		req.Body = wiki.RenderWikiPage(wiki.WikiFront{
			Title:    req.Front.Title,
			Category: req.Front.Category,
			Summary:  req.Front.Summary,
			Status:   req.Front.Status,
			Tags:     req.Front.Tags,
			Records:  req.Front.Records,
		}, req.Front.Body)
	}
	if req.IfMatch != "" {
		if page, found := currentWikiPage(state.session.WikiDir, req.Path); found && page != req.IfMatch {
			return nil, fmt.Errorf("the page changed after it was read: the page on this branch differs from the version you read")
		}
	}

	written, err := wiki.WriteWikiPage(s.Registry, state.session.WikiDir, req.Path, req.Body)
	if err != nil {
		return nil, err
	}
	s.repoSessions().wrote(req.Branch, written)
	return map[string]any{
		"path":   written,
		"digest": wiki.WikiDigest(req.Body),
	}, nil
}

func (s *Service) hostRepoBranch(args json.RawMessage) (any, error) {
	var req struct {
		Branch string `json:"branch"`
	}
	if err := decodeArgs(args, &req); err != nil {
		return nil, err
	}
	if existing, ok := s.repoSessions().get(req.Branch); ok {
		// Opening the same branch twice is a browser reload, not an error.
		return map[string]any{
			"branch":      existing.session.Branch,
			"worktree":    existing.session.Dir,
			"unversioned": existing.session.Unversioned(),
		}, nil
	}

	// The measurement decides, not the request. A caller cannot ask for the
	// unversioned route — it would be the way around the worktree of the specification —
	// and cannot ask for a branch where a branch holds nothing.
	// The measurement, and only that measurement: OpenWikiDirect takes it again
	// for itself and refuses if it disagrees, so the two never drift into a
	// route that opens a session the package would not have given it.
	if wiki.WikiUnversioned(s.Registry) {
		session, err := wiki.OpenWikiDirect(s.Registry)
		if err != nil {
			return nil, err
		}
		// Kept under the branch name the caller asked for, because that is the
		// key every later call in the walk uses. It names no branch here; it is
		// the handle on a session, and the answer says there is no branch.
		s.repoSessions().put(req.Branch, &repoSessionState{session: session})
		return map[string]any{
			"branch":      "",
			"worktree":    "",
			"unversioned": true,
			"wikiDir":     s.Registry.Rel(wiki.WikiDir(s.Registry)),
		}, nil
	}

	session, err := wiki.OpenWikiBranch(s.Registry, req.Branch)
	if err != nil {
		return nil, err
	}
	s.repoSessions().put(req.Branch, &repoSessionState{session: session})
	return map[string]any{
		"branch":      session.Branch,
		"worktree":    session.Dir,
		"unversioned": false,
	}, nil
}

// hostRepoCommit commits exactly what this session wrote.
//
// The paths come from the session's own record rather than from the request,
// which is refusal 4 held structurally: a caller cannot name a path to commit,
// so it cannot name one the host did not write.
func (s *Service) hostRepoCommit(args json.RawMessage) (any, error) {
	var req struct {
		Branch  string `json:"branch"`
		Message string `json:"message"`
	}
	if err := decodeArgs(args, &req); err != nil {
		return nil, err
	}
	state, ok := s.repoSessions().get(req.Branch)
	if !ok {
		return nil, fmt.Errorf("no open branch by that name")
	}
	commit, err := state.session.Commit(req.Message, state.written)
	if err != nil {
		return nil, err
	}
	return commit, nil
}

// hostRepoPR pushes the branch and reports what can be done next.
//
// It pushes and stops. Opening the pull request itself is left to the forge CLI
// the token came from, because this host holds no credential of its own and
// inventing an API client here would mean holding one — the decision the specification
// makes, kept rather than worked around at the last step.
func (s *Service) hostRepoPR(args json.RawMessage) (any, error) {
	var req struct {
		Branch string `json:"branch"`
		Title  string `json:"title"`
		Body   string `json:"body"`
		Remote string `json:"remote,omitempty"`
	}
	if err := decodeArgs(args, &req); err != nil {
		return nil, err
	}
	// Push arguments are deliberately closed: a caller cannot introduce a
	// destination/refspec next to the branch that identifies this session.
	if len(args) != 0 {
		decoder := json.NewDecoder(bytes.NewReader(args))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&req); err != nil {
			return nil, fmt.Errorf("a push names only branch, title, body and remote")
		}
	}
	state, ok := s.repoSessions().get(req.Branch)
	if !ok {
		return nil, fmt.Errorf("no open branch by that name")
	}
	if state.session.Unversioned() {
		// A refusal and not the 'pushed: false' state two branches down, and
		// the difference is real: that state means a push was attempted and the
		// remote said no, and it hands back the two commands for finishing by
		// hand. Here there is no branch to finish, and offering those commands
		// would send somebody after a ref that does not exist.
		return nil, fmt.Errorf("%w: %s", wiki.ErrWikiUnversioned, s.Registry.Rel(wiki.WikiDir(s.Registry)))
	}
	// The walk ends here whatever the push says: the commit lives on the branch,
	// which stays, and the worktree is only the place it was written in. Left
	// open it would be one more checkout under .git/ for every edit, for ever.
	// The branch is kept on purpose: the pull request points at it and a failed
	// push is finished by hand from it.
	defer func() {
		_ = state.session.Close()
		s.repoSessions().drop(req.Branch)
	}()
	if err := state.session.Push(req.Remote); err != nil {
		// Reported, never rolled back: the commit is somebody's writing, and
		// undoing it because a network refused would throw the writing away.
		// The branch is local, the commit stands, and the response says so.
		//
		// A success result and not an error result: the work stands, the last
		// step is outside what this host can do, and the response names which.
		// The shape is the one this tool already uses two branches down for a
		// forge it cannot open a pull request on, because that is the same kind
		// of answer.
		remote := req.Remote
		if remote == "" {
			remote = "origin"
		}
		hint := fmt.Sprintf("the branch and commit are kept; check the remote with git remote -v; then git push -u %s %s", remote, state.session.Branch)
		if wiki.WikiForgeForPush(s.Registry).Remote == "" && remote == "origin" {
			hint = fmt.Sprintf("the branch and commit are kept; configure a remote with git remote add origin <url>; then git push -u origin %s", state.session.Branch)
		}
		return map[string]any{
			"pushed":  false,
			"branch":  state.session.Branch,
			"message": err.Error(),
			"hint":    hint,
		}, nil
	}

	git := wiki.WikiForgeForPush(s.Registry)
	out := map[string]any{"pushed": true, "branch": state.session.Branch, "forge": git.Forge}
	if git.Forge == "" {

		out["pullRequest"] = false
		if git.RemoteHost == "" {
			// A remote that is a path on this machine has no host, and telling
			// somebody to declare a forge for "" is an instruction nobody can
			// follow. Its own sentence, rather than a hole in the other one.
			out["message"] = "this remote names no host, so there is no forge to open a pull request on — the branch is pushed"
		} else {
			out["message"] = "no forge is declared for " + git.RemoteHost +
				", so no pull request was opened — the branch is pushed"
			out["hint"] = "name " + git.RemoteHost + " under 'forges:' in " + facet.ConfigName +
				" (github or gitlab) and this step runs"
		}
		return out, nil
	}
	url, err := wiki.OpenWikiPullRequest(state.session, wiki.WikiState{Remote: git.Remote, RemoteHost: git.RemoteHost, Forge: git.Forge, ForgeSource: git.ForgeSource}, req.Title, req.Body)
	if err != nil {
		out["pullRequest"] = false
		out["message"] = err.Error()
		return out, nil
	}
	out["pullRequest"] = true
	out["url"] = url
	return out, nil
}

// replaceWikiBody returns the page at rel with its prose replaced and its head
// untouched. The head is everything before the body, taken as bytes from the
// file itself: wiki.SplitFrontMatter's body is a suffix of the file, so the
// head is what is left when that suffix is cut off.
func replaceWikiBody(wikiDir, rel, body string) (string, error) {
	abs, err := wiki.ResolveWikiPath(wikiDir, rel)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", fmt.Errorf("%w: %s", wiki.ErrWikiMissing, rel)
	}
	_, current, found := wiki.SplitFrontMatter(data)
	if !found && bytes.HasPrefix(data, []byte("---")) {
		// The file opens like a head and the host cannot find where it ends.
		// Treating it as headless would replace the whole file, head included.
		return "", fmt.Errorf("the page opens with a header the host cannot delimit; it is not edited here")
	}
	if !found {
		if _, _, smuggled := wiki.SplitFrontMatter([]byte(body)); smuggled {
			// A page without a head gets none through a body edit: the head is
			// not offered by this surface (the agent profile writes it).
			return "", fmt.Errorf("a body edit cannot add a header to a page that has none")
		}
	}
	head := data[:len(data)-len(current)]
	return string(head) + body, nil
}

// currentWikiPage returns the digest of a page as it is on disk right now.
func currentWikiPage(wikiDir, rel string) (string, bool) {
	abs, err := wiki.ResolveWikiPath(wikiDir, rel)
	if err != nil {
		return "", false
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return "", false
	}
	return wiki.WikiDigest(string(data)), true
}

// decodeArgs reads a host tool's arguments, treating an absent body as "{}"
// rather than an error — a tool like repo.state that takes no arguments is
// still called with Args omitted from the envelope.
func decodeArgs(args json.RawMessage, into any) error {
	if len(args) == 0 {
		args = []byte("{}")
	}
	if err := json.Unmarshal(args, into); err != nil {
		return fmt.Errorf("this call is not readable JSON")
	}
	return nil
}

// writeJSON answers with an object.
//
// Only 200, and the missing status parameter is the point rather than an
// omission. Every JSON answer on these routes is an answer: a refusal is
// reported through the plugin-call envelope's own 'error' field with its own
// text, and a push that did not happen is a state this tool reports rather
// than a failure it suffered. A status parameter here was what let a
// perfectly good answer go out as a 502 and be read as an error body.
