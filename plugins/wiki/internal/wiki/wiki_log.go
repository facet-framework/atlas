package wiki

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/facet-framework/core/registry"
)

// WikiLogLimit caps how many commits one page history answers. A page with a
// longer past still shows its newest commits; the cap keeps one call bounded.
const WikiLogLimit = 20

// WikiLogCommit is one commit that touched a page.
type WikiLogCommit struct {
	Hash    string `json:"hash"`
	Author  string `json:"author"`
	Date    string `json:"date"`
	Subject string `json:"subject"`
}

// WikiLog is the answer of repo.log, in one of three states that are never
// confused with each other:
//
//   - Unversioned: no repository holds the wiki, so there is no history to
//     read. An empty list would claim "no commits", which is a different and
//     measured statement.
//   - Shallow: the commits found, from a clone that does not carry the whole
//     past, so the list may be incomplete.
//   - otherwise: the list, possibly empty when the page was never committed.
type WikiLog struct {
	Unversioned bool            `json:"unversioned"`
	Shallow     bool            `json:"shallow"`
	Commits     []WikiLogCommit `json:"commits"`
}

// WikiPageLog reads the history of one wiki page with `git log --follow`.
//
// It reads only under the wiki directory: the path goes through
// ResolveWikiPath, which refuses anything that leaves it, and nothing the
// caller sent reaches git except that resolved path.
func WikiPageLog(reg facet.Registry, rel string) (WikiLog, error) {
	abs, err := ResolveWikiPath(WikiDir(reg), rel)
	if err != nil {
		return WikiLog{}, err
	}
	if WikiUnversioned(reg) {
		return WikiLog{Unversioned: true, Commits: []WikiLogCommit{}}, nil
	}
	root := wikiRepositoryRoot(reg)
	if root == "" {
		return WikiLog{Unversioned: true, Commits: []WikiLogCommit{}}, nil
	}
	out := WikiLog{Commits: []WikiLogCommit{}}
	if shallow, err := runGitLog(root, "rev-parse", "--is-shallow-repository"); err == nil {
		out.Shallow = strings.TrimSpace(shallow) == "true"
	}
	const sep = "\x1f"
	raw, err := runGitLog(root, wikiLogArgs(abs, sep)...)
	if err != nil {
		// A path git has never seen answers an empty log with exit 0; a real
		// failure is reported, not turned into an empty history.
		return WikiLog{}, fmt.Errorf("git log failed: %s", strings.TrimSpace(raw))
	}
	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, sep, 4)
		if len(parts) != 4 {
			continue
		}
		out.Commits = append(out.Commits, WikiLogCommit{Hash: parts[0], Author: parts[1], Date: parts[2], Subject: parts[3]})
	}
	return out, nil
}

// wikiLogTimeout bounds one history read: a stuck git must not hold a request.
const wikiLogTimeout = 10 * time.Second

// runGitLog runs git log in dir with a deadline.
func runGitLog(dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), wikiLogTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// wikiLogArgs is the whole argument list of the history read. The path comes
// after "--" so that git can never read it as an option, whatever it is.
func wikiLogArgs(abs, sep string) []string {
	return []string{"log", "--follow", fmt.Sprintf("-n%d", WikiLogLimit),
		"--format=%H" + sep + "%an" + sep + "%aI" + sep + "%s", "--", abs}
}
