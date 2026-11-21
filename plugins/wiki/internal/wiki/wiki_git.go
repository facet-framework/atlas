// WikiState measures the wiki directory, branch, remote, detected forge and its
// source, token source, and dirty tree for the host state line.
// OpenWikiDirect and WikiUnversioned handle checkout writes where a commit
// cannot reach the wiki directory.
package wiki

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/facet-framework/core/registry"
)

// ErrWikiDefaultBranch is refusal 6: the target is never the branch the project
// merges into. A proposal a human merges is the one rule that makes everything
// else here bearable.
var ErrWikiDefaultBranch = facet.ErrDefaultBranch

// ErrWikiNoRepository is a write asked of a directory git does not know about.
var ErrWikiNoRepository = facet.ErrNoRepository

// ErrWikiVersioned refuses an unversioned write where a versioned one works.
//
// The unversioned route writes into the checkout somebody is coding in, which
// the specification exists to prevent: a page dropped beside half-finished work is the
// commit they did not mean to make. It is offered where the versioned route
// cannot work — no repository, or a wiki directory git has been told to ignore
// — and refused everywhere else, by name rather than by convention.
var ErrWikiVersioned = errors.New("this wiki is versioned: write it on a branch")

// ErrWikiUnversioned is a commit or a push asked of a session that has neither.
//
// Its own error for refusal 4's reason one level up: the convenient reading of
// "commit a session with no branch" is "stage the tree on whatever is checked
// out", and that is a commit on somebody's working branch holding their code.
// A caller is told which state it is in rather than watching nothing happen.
var ErrWikiUnversioned = errors.New("this wiki is written without git: there is nothing to commit")

// ErrWikiNothingToCommit is a commit that named no page.
//
// Its own error rather than a bare message, because the alternative reading of
// "no paths" is "stage the tree", and this package has to be the one that says
// no. Left to git the refusal still happens — an empty pathspec finds nothing
// to commit — but by accident, and an accident is not a refusal: the day a
// caller's empty list arrives alongside something already staged, git commits
// it.
var ErrWikiNothingToCommit = facet.ErrNothingToCommit

// wikiBranchRe is what may be a branch name.
//
// Narrow on purpose. The value arrives from a browser or from an agent and ends
// up on a git command line, so the risk is argument injection rather than
// typos: a name beginning with a dash is read as a flag by whatever parses it,
// and the flags next door include ones that run a program. The same reasoning
// the reader's model name already carries.
var wikiBranchRe = facet.BranchNamePattern

// WikiSession is one write session: a branch and a worktree to write it in.
//
// The worktree is the structurally important decision of the specification. Whoever has
// Atlas open usually has code in progress, and a write path that used the same
// working directory would force them to put it away before changing a sentence
// — and would, at worst, commit something half-finished along with the page.
// So the host makes its own checkout, under .git/, where nothing will ever
// mistake it for repository content and no scan will read it.
type WikiSession struct {
	// Dir is the worktree root.
	Dir string
	// WikiDir is the wiki directory inside the worktree — where pages are
	// written. Callers pass this to WriteWikiPage instead of the registry's own
	// wiki directory, which is what keeps the working tree untouched.
	WikiDir string
	// Branch is the branch this session writes on.
	Branch string
	// Root is the repository the worktree belongs to.
	Root string
	// wikiRel is the wiki directory relative to the repository root, so a
	// commit can turn a page path into a repository path.
	wikiRel string
	// unversioned marks the session OpenWikiDirect makes: no branch, no
	// worktree, writes straight into the checkout.
	//
	// A flag rather than a second type, because every caller that holds a
	// session writes pages through WikiDir and that half is identical. What
	// differs is the three git verbs, and each of them refuses here rather than
	// doing something plausible on a repository it has no branch in.
	unversioned bool
}

// Unversioned reports whether this session writes without git.
//
// Exported because a surface has to say so, and has to keep saying so: a wiki
// that looks versioned and is not is the worse state of the two, so the caller
// that opened the session is the one that tells the reader.
func (s *WikiSession) Unversioned() bool { return s != nil && s.unversioned }

// WikiCommit is what a commit produced.
type WikiCommit = facet.CommitResult

// OpenWikiBranch creates a branch and a worktree to write it in.
func OpenWikiBranch(reg facet.Registry, branch string) (*WikiSession, error) {
	if err := wikiInitializationError(reg); err != nil {
		return nil, err
	}
	branch = strings.TrimSpace(branch)
	if !wikiBranchRe.MatchString(branch) {
		return nil, fmt.Errorf("%w: %q is not a branch name", ErrWikiPathGrammar, branch)
	}
	// '..' would be refused by the grammar above as a name, but not inside one;
	// a branch called 'wiki/../main' is the default branch wearing a costume.
	if strings.Contains(branch, "..") {
		return nil, fmt.Errorf("%w: %q", ErrWikiPathGrammar, branch)
	}
	root := wikiRepositoryRoot(reg)
	if root == "" {
		root = reg.Root
	}
	if facet.IsDefaultBranch(root, branch) {
		return nil, fmt.Errorf("%w: %q", ErrWikiDefaultBranch, branch)
	}
	if !isGitRepository(root) {
		return nil, ErrWikiNoRepository
	}

	// Inside .git/ so that it is never repository content: this project's own
	// scan walks the whole tree, and a second checkout of the repository inside
	// the repository would be read as a second copy of every file in it.
	gitDir, err := facet.GitCommonDir(root)
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(gitDir, "facet-wiki", filepath.FromSlash(branch))
	if err := os.MkdirAll(filepath.Dir(dir), 0o755); err != nil {
		return nil, err
	}

	// A branch that already exists is checked out rather than recreated, so a
	// session resumed after a browser reload continues where it left off
	// instead of failing on the second click.
	args := []string{"worktree", "add"}
	if branchExists(root, branch) {
		args = append(args, dir, branch)
	} else {
		args = append(args, "-b", branch, dir)
	}
	if out, err := runGitIn(root, args...); err != nil {
		return nil, fmt.Errorf("could not create the worktree: %v: %s", err, out)
	}

	relative, err := filepath.Rel(root, resolveExisting(WikiDir(reg)))
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		_, _ = runGitIn(root, "worktree", "remove", "--force", dir)
		return nil, ErrWikiPathEscape
	}
	wikiRel := filepath.ToSlash(relative)
	return &WikiSession{
		Dir:     dir,
		WikiDir: filepath.Join(dir, filepath.FromSlash(wikiRel)),
		Branch:  branch,
		Root:    root,
		wikiRel: wikiRel,
	}, nil
}

// OpenWikiDirect returns a session that writes directly into the checkout when
// the project has no Git repository or Git ignores new wiki pages. It returns
// an initialization error for an invalid wiki layout and ErrWikiVersioned for
// an ordinary versioned wiki. Refusing that case protects the active checkout;
// versioned writes belong in the isolated worktree described by the specification.
func OpenWikiDirect(reg facet.Registry) (*WikiSession, error) {
	if err := wikiInitializationError(reg); err != nil {
		return nil, err
	}
	// Use the route's measurement so the session writes where the route expects.
	if !WikiUnversioned(reg) {
		return nil, fmt.Errorf("%w: %s", ErrWikiVersioned, reg.Rel(WikiDir(reg)))
	}
	return &WikiSession{
		Dir:         reg.Root,
		WikiDir:     WikiDir(reg),
		Root:        reg.Root,
		wikiRel:     reg.Rel(WikiDir(reg)),
		unversioned: true,
	}, nil
}

// Commit stages exactly the paths the host wrote and commits them.
//
// Refusal 4, and the reason it is a refusal rather than a convention: 'git add
// -A' in a worktree would sweep up whatever else is lying in it, and the page
// being committed is the only thing in the tree the host can vouch for. Each
// path is re-checked through ResolveWikiPath — not trusted because a caller
// just passed it to a write — and the pathspec is separated from the options by
// '--', so a path that looks like a flag cannot become one.
func (s *WikiSession) Commit(message string, pages []string) (WikiCommit, error) {
	if s.unversioned {
		// Before the message check, because "which state is this session in" is
		// the larger answer: a caller told "a commit needs a message" would go
		// and find one.
		return WikiCommit{}, fmt.Errorf("%w: %s", ErrWikiUnversioned, s.wikiRel)
	}
	if strings.TrimSpace(message) == "" {
		return WikiCommit{}, errors.New("a commit needs a message")
	}
	if len(pages) == 0 {
		// Refusing rather than falling back to staging the tree: a caller that
		// named nothing has a bug, and the convenient interpretation of that
		// bug is the one refusal 4 exists to prevent.
		return WikiCommit{}, fmt.Errorf("%w: a commit must name the pages it commits", ErrWikiNothingToCommit)
	}

	specs := make([]string, 0, len(pages))
	var skipped []string
	for _, page := range pages {
		abs, err := ResolveWikiPath(s.WikiDir, page)
		if err != nil {
			return WikiCommit{}, err
		}
		spec := filepath.ToSlash(filepath.Join(s.wikiRel, filepath.FromSlash(strings.TrimSpace(page))))
		// A path reaches git only when git has something to record about it:
		// a file that is on disk, or one still in the index and therefore about
		// to be recorded as deleted. The second case is the source half of a
		// rename of a page that had been committed before — without it the
		// commit adds the new file and leaves its predecessor behind, which is
		// two files with one content.
		//
		// A path that is neither is skipped rather than refused, and the case
		// is ordinary rather than exotic: a page written on this branch and
		// renamed before the first commit was never in the index and is no
		// longer on disk, so there is nothing to stage — and git, handed such a
		// pathspec, fails the whole commit over it.
		//
		// Skipped, never silently: the caller is told, because "committed" and
		// "committed all but one of the things you named" are different
		// answers.
		if _, err := os.Stat(abs); err != nil && !trackedIn(s.Dir, spec) {
			skipped = append(skipped, filepath.ToSlash(strings.TrimSpace(page)))
			continue
		}
		specs = append(specs, spec)
	}

	if len(specs) == 0 {
		// Everything named had nothing for git to record. Refused rather than
		// committed empty, for the same reason an empty list is: the caller
		// believes it wrote something, and an empty commit would agree with it.
		return WikiCommit{}, fmt.Errorf("%w: nothing named is on disk or in the index (%s)",
			ErrWikiNothingToCommit, strings.Join(skipped, ", "))
	}

	add := append([]string{"add", "--"}, specs...)
	if out, err := runGitIn(s.Dir, add...); err != nil {
		return WikiCommit{}, fmt.Errorf("could not stage the pages: %v: %s", err, out)
	}
	commit := append([]string{"commit", "-m", message, "--"}, specs...)
	if out, err := runGitIn(s.Dir, commit...); err != nil {
		return WikiCommit{}, fmt.Errorf("could not commit: %v: %s", err, out)
	}
	sha, err := runGitIn(s.Dir, "rev-parse", "HEAD")
	if err != nil {
		return WikiCommit{}, err
	}
	return WikiCommit{SHA: strings.TrimSpace(sha), Files: specs, Skipped: skipped}, nil
}

// Push sends the session's branch to the remote.
//
// The target is always the branch this session created. There is no parameter
// for it, which is how refusal 6 is kept rather than checked: a caller cannot
// name a target, so it cannot name the default branch.
func (s *WikiSession) Push(remote string) error {
	if s.unversioned {
		return fmt.Errorf("%w: %s", ErrWikiUnversioned, s.wikiRel)
	}
	if remote == "" {
		remote = "origin"
	}
	if !wikiBranchRe.MatchString(remote) {
		return fmt.Errorf("%w: %q is not a remote name", ErrWikiPathGrammar, remote)
	}
	if out, err := runGitIn(s.Dir, "push", "--set-upstream", remote, s.Branch); err != nil {
		// Reported rather than rolled back. The commit is the work; undoing it
		// because the network refused would throw away what somebody wrote, and
		// the two commands to finish by hand are worth more than a clean slate.
		return fmt.Errorf("the push was refused: %v: %s", err, out)
	}
	return nil
}

// Close removes the worktree and leaves the branch.
//
// The branch stays because the commit on it is the work. The worktree goes
// because a forgotten one is a second checkout of the repository that nobody
// knows is there, and it accumulates one per session.
func (s *WikiSession) Close() error {
	if s == nil || s.Dir == "" {
		return nil
	}
	if s.unversioned {
		// Nothing was made, so nothing is removed — and the check is not
		// decorative: this session's Dir is the repository root, and handing
		// that to 'git worktree remove --force' is the working tree being
		// deleted.
		return nil
	}
	if out, err := runGitIn(s.Root, "worktree", "remove", "--force", s.Dir); err != nil {
		return fmt.Errorf("could not remove the worktree at %s: %v: %s", s.Dir, err, out)
	}
	return nil
}

// ErrWikiUninitialized refuses a write into a gitlink without its checkout.
var ErrWikiUninitialized = errors.New("the wiki submodule is not initialized")

// WikiInitialization names an unavailable indexed checkout and its local remedy.
type WikiInitialization struct {
	Path    string `json:"path"`
	Command string `json:"command"`
}

// WikiAvailability is one read of the Wiki's checkout and Git owner. Corpus
// builders reuse it instead of re-reading the index for each presentation field.
type WikiAvailability struct {
	Initialization *WikiInitialization
	GitError       error
	Unversioned    bool
}

// WikiAvailabilityState probes only the possible containing gitlink paths.
// A present Git marker is authoritative, including a damaged marker. No marker
// anywhere retains the ordinary no-Git create flow.
func WikiAvailabilityState(reg facet.Registry) WikiAvailability {
	for dir := resolveExisting(WikiDir(reg)); dir != ""; {
		_, err := os.Lstat(filepath.Join(dir, ".git"))
		if err == nil {
			out, err := runGitIn(dir, "--git-dir="+filepath.Join(dir, ".git"), "rev-parse", "--show-toplevel")
			if err != nil {
				return WikiAvailability{GitError: fmt.Errorf("could not read the wiki Git repository: %w: %s", err, strings.TrimSuffix(out, "\n"))}
			}
			root := strings.TrimSuffix(out, "\n")
			module, err := wikiIndexedCheckout(root, resolveExisting(WikiDir(reg)))
			if err != nil {
				return WikiAvailability{GitError: err}
			}
			if module != "" {
				relative, err := filepath.Rel(resolveExisting(reg.Root), filepath.Join(root, filepath.FromSlash(module)))
				if err != nil {
					return WikiAvailability{GitError: err}
				}
				path := filepath.ToSlash(relative)
				return WikiAvailability{Initialization: &WikiInitialization{Path: path, Command: "git submodule update --init -- " + shellQuote(path)}}
			}
			return WikiAvailability{Unversioned: pathIsIgnored(root, resolveExisting(WikiDir(reg)))}
		}
		if !os.IsNotExist(err) {
			return WikiAvailability{GitError: fmt.Errorf("could not read the wiki Git marker: %w", err)}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		for _, ceiling := range filepath.SplitList(os.Getenv("GIT_CEILING_DIRECTORIES")) {
			if filepath.IsAbs(ceiling) && resolveExisting(ceiling) == parent {
				return WikiAvailability{Unversioned: true}
			}
		}
		dir = parent
	}
	return WikiAvailability{Unversioned: true}
}

// wikiIndexedCheckout reads stage-zero index modes without a source inventory.
// The empty tree comparison is read-only (hash-object has no -w). Each literal
// candidate excludes descendants, so unrelated content never enters the result.
func wikiIndexedCheckout(root, target string) (string, error) {
	empty := exec.Command("git", "-C", root, "hash-object", "-t", "tree", "--stdin")
	empty.Stdin = strings.NewReader("")
	hash, err := empty.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("could not read Git object format: %w: %s", err, strings.TrimSuffix(string(hash), "\n"))
	}
	relative, err := filepath.Rel(root, target)
	if err != nil {
		return "", err
	}
	if relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", ErrWikiPathEscape
	}
	// Even a Wiki at the repository root needs an index-read probe. The exact
	// root candidate yields no paths, while a corrupt index remains a real error.
	for candidate := relative; ; candidate = filepath.Dir(candidate) {
		name := filepath.ToSlash(candidate)
		if candidate == "." {
			name = ".git" // Git never tracks its own metadata directory.
		}
		escaped := strings.NewReplacer("\\", "\\\\", "*", "\\*", "?", "\\?", "[", "\\[").Replace(name)
		out, err := runGitIn(root, "diff", "--cached", "--raw", "-z", "--no-abbrev", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=none", strings.TrimSuffix(string(hash), "\n"), "--", ":(literal)"+name, ":(exclude,glob)"+escaped+"/**")
		if err != nil {
			return "", fmt.Errorf("could not read Git index: %w: %s", err, strings.TrimSuffix(out, "\n"))
		}
		entries := strings.Split(out, "\x00")
		for i := 0; i+1 < len(entries); i += 2 {
			fields := strings.Fields(entries[i])
			if len(fields) == 5 && fields[1] == "160000" && fields[4] == "A" && entries[i+1] == name {
				if _, err := os.Lstat(filepath.Join(root, candidate, ".git")); os.IsNotExist(err) {
					return name, nil
				}
			}
		}
		if candidate == "." {
			break
		}
	}
	return "", nil
}

// WikiInitializationState measures Git's index, not an optional .gitmodules entry.
func WikiInitializationState(reg facet.Registry) *WikiInitialization {
	return WikiAvailabilityState(reg).Initialization
}

// WikiRepositoryError preserves real marker and index failures.
func WikiRepositoryError(reg facet.Registry) error { return WikiAvailabilityState(reg).GitError }

func wikiInitializationError(reg facet.Registry) error {
	state := WikiAvailabilityState(reg)
	if state.Initialization != nil {
		return fmt.Errorf("%w: %s; %s", ErrWikiUninitialized, state.Initialization.Path, state.Initialization.Command)
	}
	return state.GitError
}

// WikiState is what the host knows before it offers anything.
//
// Asked once when the editor opens, which is the point: the sign-in notice
// belongs beside the button before it is pressed, not behind it. The companion
// state route exists for exactly this reason and says so; the write path needs
// more of the same courtesy, because otherwise the first obstacle is discovered
// after a page has been written.
//
// Every field is what was found, and nothing stands in for what was not. No
// token is not an error — it is the ordinary first run.
type WikiState struct {
	// GitError reports failed Git metadata reads, never an absent checkout.
	GitError string `json:"gitError,omitempty"`
	// Initialization is present only for a real gitlink without a checkout.
	Initialization *WikiInitialization `json:"initialization,omitempty"`
	// Repository reports whether this is a git repository at all.
	Repository bool `json:"repository"`
	// Branch is what is checked out now, empty outside a repository.
	Branch string `json:"branch,omitempty"`
	// Remote is the push URL of 'origin', empty when there is none.
	Remote string `json:"remote,omitempty"`
	// Forge is "github", "gitlab", or empty — and empty is a real answer,
	// meaning a forge this host could not place. Said out loud rather than
	// swallowed: branch and commit still work there.
	Forge string `json:"forge,omitempty"`
	// ForgeSource is ForgeFromRemote for recognition, ConfigName for a project
	// declaration, or empty for an unknown forge. Preserve provenance so a
	// declared value is not presented as a host measurement.
	ForgeSource string `json:"forgeSource,omitempty"`
	// RemoteHost is the host the remote points at, empty when there is none.
	//
	// Reported separately from Remote because it is the thing a project writes
	// into 'forges:', and a surface telling somebody what to declare has to name
	// it exactly rather than leave them to cut it out of a URL.
	RemoteHost string `json:"remoteHost,omitempty"`
	// TokenSource names where a token was found — "GITHUB_TOKEN", "gh" — or is
	// empty when none was. Named rather than a boolean, so somebody who has two
	// can see which one is about to be used.
	TokenSource string `json:"tokenSource,omitempty"`
	// Dirty reports whether the working tree has uncommitted changes. Not an
	// obstacle: it is why the worktree exists, and the surface says so rather
	// than asking anybody to tidy up.
	Dirty bool `json:"dirty"`
	// Wiki reports an available wiki directory, excluding unavailable Git checkouts.
	Wiki bool `json:"wiki"`
	// Ignored reports whether git would refuse a page written into the wiki
	// directory.
	//
	// Phrased about a page rather than about the directory because that is what
	// is measured, and because the two answers differ in real layouts — a
	// directory holding one force-added page is tracked while a new page beside
	// it is still refused. What the create path is about to do is write a page,
	// so that is what is asked.
	//
	// Measured rather than inferred, and measured by git itself: whether a path
	// is ignored is a question .gitignore answers, and a second reading of those
	// patterns here would be a second answer free to disagree with the one that
	// decides whether 'git add' does anything.
	//
	// It is its own field rather than a second meaning for Repository, because
	// the two states want different sentences. "No repository" is a project git
	// knows nothing about; this is a project git knows well, whose wiki
	// directory it has been told to leave alone. What they share is only the
	// consequence — no branch, no commit, a page written straight into the
	// checkout.
	//
	// False outside a repository, and false there means "not measured". A reader
	// that acts on this field reads Repository with it; the struct never claims
	// a measurement it did not take.
	Ignored bool `json:"ignored"`
	// WikiDir is where this registry's wiki lives or would live, relative to the
	// repository root.
	//
	// Reported whether or not it exists, because the surface that offers to
	// create one has to name the place — and a surface naming a directory it
	// worked out for itself would be stating a path nobody measured. It is the
	// registry's answer, so a repository declaring several registries gets the
	// one whose wiki is about to be written rather than a guess at the default.
	WikiDir string `json:"wikiDir"`
}

// WikiGitState answers what the host found.
func WikiGitState(reg facet.Registry) WikiState {
	availability := WikiAvailabilityState(reg)
	if availability.Initialization != nil {
		return WikiState{Repository: isGitRepository(reg.Root), WikiDir: reg.Rel(WikiDir(reg)), Initialization: availability.Initialization}
	}
	if err := availability.GitError; err != nil {
		state := WikiState{WikiDir: reg.Rel(WikiDir(reg)), GitError: err.Error()}
		if info, statErr := os.Stat(WikiDir(reg)); statErr == nil {
			state.Wiki = info.IsDir()
		}
		return state
	}
	state := WikiState{WikiDir: reg.Rel(WikiDir(reg))}
	if st, err := os.Stat(WikiDir(reg)); err == nil && st.IsDir() {
		state.Wiki = true
	}
	root := wikiRepositoryRoot(reg)
	if root == "" {
		return state
	}
	state.Repository = true

	if out, err := runGitIn(root, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		state.Branch = strings.TrimSpace(out)
	}
	// The forge comes from 'remote get-url', not 'config remote.origin.url':
	// with git's 'url.<base>.insteadOf' rewrites the first reports where git
	// actually pushes, the second what somebody typed.
	//
	// Where they differ, the first is the one this file wants. The forge here
	// is not a label on the project — it is the server a pull request has to be
	// opened on, and that is the server the branch was pushed to. A repository
	// whose remote is rewritten somewhere else has its branch somewhere else,
	// and reporting the forge of the name it was typed under would name a
	// server the commit never reached.
	//
	// The common corporate rewrite does not differ at all, because it swaps the
	// protocol and keeps the host ('https://github.com/' to 'git@github.com:'),
	// and both sides give the same answer to remoteHost.
	forge := WikiForgeForPush(reg)
	state.Remote, state.RemoteHost = forge.Remote, forge.RemoteHost
	state.Forge, state.ForgeSource = forge.Forge, forge.ForgeSource

	if out, err := runGitIn(root, "status", "--porcelain"); err == nil {
		state.Dirty = strings.TrimSpace(out) != ""
	}
	state.Ignored = pathIsIgnored(root, resolveExisting(WikiDir(reg)))
	state.TokenSource = WikiTokenSource(state.Forge, state.RemoteHost)
	return state
}

// WikiPushForge contains only metadata needed after a proposal push. It makes
// no claim about the state or contents of the user's working files.
type WikiPushForge = facet.PushForge

// WikiForgeForPush reads the owning repository's remote and forge declaration
// without git status, which can read unfinished working files to hash them.
func WikiForgeForPush(reg facet.Registry) WikiPushForge {
	return facet.ForgeForPush(wikiRepositoryRoot(reg), reg.Root)
}

// WikiUnversioned reports whether a wiki's pages are held by nothing.
//
// The two measurements WikiGitState also takes — is this a repository, does git
// ignore the wiki directory — and nothing else. Its own function because the
// corpus needs exactly this and is built on every read: WikiGitState
// additionally looks for a forge token, and finding one means running 'gh auth
// token' as a subprocess. That cost is right once when an editor opens and
// wrong on every corpus build.
func WikiUnversioned(reg facet.Registry) bool {
	return WikiAvailabilityState(reg).Unversioned
}

// wikiRepositoryRoot asks the nearest existing wiki ancestor which working
// tree owns it. Initialised submodules and nested clones have their own owner;
// a wiki that is not created yet retains its parent repository's behaviour.
func wikiRepositoryRoot(reg facet.Registry) string {
	dir := resolveExisting(WikiDir(reg))
	if dir == "" {
		return ""
	}
	for {
		if info, err := os.Stat(dir); err == nil {
			if !info.IsDir() {
				return ""
			}
			out, err := runGitIn(dir, "rev-parse", "--show-toplevel")
			if err != nil {
				return ""
			}
			return strings.TrimSuffix(out, "\n")
		} else if !os.IsNotExist(err) {
			return ""
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// wikiProbePage is a valid, unwritten page path used by git check-ignore without
// touching disk. Probe a new page, not the directory: a force-added sibling can
// make an ignored directory appear tracked, and wiki/**/*.md can ignore pages
// without matching their directory. Neither case permits staging a new page.
const wikiProbePage = "onboarding/probe.md"

// pathIsIgnored asks git whether a page written here would reach a commit.
//
// 'git check-ignore -q' on a page inside the wiki directory. Measured against
// what 'git add' actually does across six layouts — ordinary, wholly ignored,
// ignored with one page force-added, an ignored parent with the wiki negated
// back in, only '*.md' ignored, and a whole ignored ancestor — this query
// agrees in all six, where the same question asked about the *directory*
// disagrees in two.
//
// '--no-index' is absent, and the honest reason is that it changes nothing
// here rather than that it would be wrong: at page level the two forms agree
// in all six layouts. They differ only where the probe path is itself tracked,
// and there the plain form is the wrong one — it would report a wiki as
// writable whose new pages git refuses. That is why the probe is a name
// nothing writes: it keeps the case from arising rather than handling it.
// Somebody who force-adds 'onboarding/probe.md' specifically defeats this, and
// that is a trade taken knowingly, not an oversight.
//
// Exit 0 is ignored; everything else is not. Only 0 makes this true, and that
// is the whole rule: a git that could not answer — 128 outside a repository, a
// binary that is not installed — must not produce a true, because a true here
// sends the create path down the unversioned route on a measurement nobody
// took. Callers establish the repository first, so the remaining unanswerable
// cases are a broken git rather than an ordinary state.
func pathIsIgnored(root, wikiDir string) bool {
	probe := filepath.Join(wikiDir, filepath.FromSlash(wikiProbePage))
	cmd := exec.Command("git", "check-ignore", "-q", "--", probe)
	cmd.Dir = root
	return cmd.Run() == nil
}

// WikiTokenSource reports where a forge token would come from, by name.
//
// Reports the environment variable or forge CLI used for authentication.
// The token itself is never returned.
// source will be used, and a value that never leaves this process cannot be
// logged, echoed into a page, or sent to the browser by a later mistake.
// The host argument is the server the CLI must be asked about. Both CLIs answer
// for their public host unless told otherwise, so a 'glab auth status' run
// without GITLAB_HOST reports on gitlab.com — an answer about a machine the
// reader has nothing to do with, and a "signed in" that means nothing here.
func WikiTokenSource(forge, host string) string {
	switch forge {
	case "gitlab":
		if os.Getenv("GITLAB_TOKEN") != "" {
			return "GITLAB_TOKEN"
		}
		if cliAvailable("glab", facet.ForgeHostEnv(forge, host)) {
			return "glab"
		}
	default:
		if os.Getenv("GITHUB_TOKEN") != "" {
			return "GITHUB_TOKEN"
		}
		if cliAvailable("gh", facet.ForgeHostEnv(forge, host)) {
			return "gh"
		}
	}
	return ""
}

// cliAvailable reports whether a forge CLI is installed and signed in — at the
// host it is pointed at, which for a self-hosted forge is not the default one.
func cliAvailable(name string, env []string) bool {
	if _, err := exec.LookPath(name); err != nil {
		return false
	}
	var cmd *exec.Cmd
	switch name {
	case "gh":
		cmd = exec.Command("gh", "auth", "token")
	case "glab":
		cmd = exec.Command("glab", "auth", "status")
	default:
		return false
	}
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), env...)
	}
	return cmd.Run() == nil
}

// trackedIn reports whether git has a path in its index — which is what makes
// a deleted file still stageable, as the source half of a
// rename must be.
func trackedIn(dir, spec string) bool {
	out, err := runGitIn(dir, "ls-files", "--error-unmatch", "--", spec)
	return err == nil && strings.TrimSpace(out) != ""
}

func branchExists(root, branch string) bool {
	_, err := runGitIn(root, "rev-parse", "--verify", "--quiet", "refs/heads/"+branch)
	return err == nil
}

func isGitRepository(root string) bool {
	out, err := runGitIn(root, "rev-parse", "--is-inside-work-tree")
	return err == nil && strings.TrimSpace(out) == "true"
}

// runGitIn runs one git command in a directory.
//
// The only way this package runs git, and there is deliberately no variant that
// takes a caller's arguments: refusal 5 is kept by there being no passthrough
// to keep rather than by a check on one. Every argument below is either a
// literal in this file or a value this package formatted itself.
func runGitIn(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// OpenWikiPullRequest opens the pull request for a session's branch.
//
// Delegates authentication and pull-request creation to the configured forge CLI.
//
// It is also why the failure here is soft. A forge that is neither GitHub nor
// GitLab, or a CLI that is not installed, loses the last step and nothing else:
// the branch is pushed and the commit stands, and the caller is told what is
// missing rather than left with a button that did nothing.
func OpenWikiPullRequest(s *WikiSession, state WikiState, title, body string) (string, error) {
	if s.Unversioned() {
		// There is no branch to propose. Said here as well as at Push, because
		// this function is reachable without one — a caller that skipped the
		// push would otherwise reach a CLI with an empty '--head'.
		return "", fmt.Errorf("%w: %s", ErrWikiUnversioned, s.wikiRel)
	}
	return facet.OpenPullRequest(s.Dir, s.Branch, facet.PushForge{
		Remote:      state.Remote,
		RemoteHost:  state.RemoteHost,
		Forge:       state.Forge,
		ForgeSource: state.ForgeSource,
	}, title, body)
}
