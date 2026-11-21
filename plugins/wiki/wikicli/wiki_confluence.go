package wikicli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"

	facetwiki "github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
	"github.com/facet-framework/core/cli"
	"github.com/facet-framework/core/registry"
	"github.com/spf13/cobra"
)

// confluenceSourceName is what this build's only source is called on a
// command line and in the mirror state's 'target'.
const confluenceSourceName = "confluence"

// confluenceBroker resolves the plugin broker the CLI reaches Confluence
// through, refusing plainly when there is none installed.
//
// Every Confluence-shaped call this file makes goes through "wiki" ·
// "confluence.import"/"confluence.mirror" rather than a linked client — the
// same door the UI's two routes use (internal/ui/confluence.go), so a
// credential never has to be read anywhere in this binary except inside the
// sidecar's own process.
func confluenceBroker() (*facet.PluginBroker, error) {
	dir := cli.PluginsDir()
	if dir == "" {
		return nil, fmt.Errorf("no plugin directory is configured — confluence runs as the wiki " +
			"plugin's own sidecar, and there is nowhere to find its binary")
	}
	return facet.NewPluginBroker(dir), nil
}

// confluenceImportReply is what confluence.import answers, decoded here
// rather than in the sidecar package, which this binary does not import.
type confluenceImportReply struct {
	Report facetwiki.WikiImportReport `json:"report"`
	Pages  map[string]string          `json:"pages"`
	Calls  int                        `json:"calls"`
}

// confluenceMirrorReply is what confluence.mirror answers.
type confluenceMirrorReply struct {
	Report facetwiki.WikiMirrorReport `json:"report"`
	State  *facetwiki.WikiMirrorState `json:"state"`
	Calls  int                        `json:"calls"`
}

// runConfluenceImport calls the sidecar's confluence.import, then writes what
// it converted through the wiki's own write path — the one place a page's
// path is actually checked against the six refusals ResolveWikiPath applies.
// The sidecar converts and reports what could not carry across; this
// function is what turns a converted page into a file, or a refusal, and it
// therefore also decides what the caller may commit.
func runConfluenceImport(ctx context.Context, reg facet.Registry, wikiDir, ref string) (facetwiki.WikiImportReport, int, error) {
	broker, err := confluenceBroker()
	if err != nil {
		return facetwiki.WikiImportReport{}, 0, err
	}
	defer broker.StopAll()

	args, err := json.Marshal(struct {
		Ref string `json:"ref"`
	}{Ref: ref})
	if err != nil {
		return facetwiki.WikiImportReport{}, 0, err
	}
	reply, err := broker.Call(ctx, "wiki", "confluence.import", args)
	if err != nil {
		return facetwiki.WikiImportReport{}, 0, err
	}
	if reply.Error != "" {
		// The sidecar's own refusal — e.g. no
		// credentials configured. Decoding reply.Result here would find
		// nothing and report the generic "unexpected end of JSON input"
		// instead of the real reason the sidecar already gave.
		return facetwiki.WikiImportReport{}, 0, fmt.Errorf("confluence.import: %s", reply.Error)
	}
	var out confluenceImportReply
	if err := json.Unmarshal(reply.Result, &out); err != nil {
		return facetwiki.WikiImportReport{}, 0, fmt.Errorf("confluence.import: bad reply: %w", err)
	}

	report := facetwiki.WikiImportReport{Source: out.Report.Source, Ref: out.Report.Ref}
	report.Lost = append(report.Lost, out.Report.Lost...)

	written := map[string]facetwiki.WikiImportedPage{}
	for _, page := range out.Report.Pages {
		written[page.Path] = page
	}
	rels := make([]string, 0, len(out.Pages))
	for rel := range out.Pages {
		rels = append(rels, rel)
	}
	sort.Strings(rels)
	var replacedExisting []string
	for _, rel := range rels {
		// The sidecar cannot answer this — its writer only ever held the page
		// in memory (see confluenceMemoryWriter in main.go) — so the host asks
		// the one place that can: whether a file already sits at the resolved
		// path, checked before the write that is about to replace it.
		replaced := false
		if abs, resolveErr := facetwiki.ResolveWikiPath(wikiDir, rel); resolveErr == nil {
			if _, statErr := os.Stat(abs); statErr == nil {
				replaced = true
			}
		}
		path, err := facetwiki.WriteWikiPage(reg, wikiDir, rel, out.Pages[rel])
		if err != nil {
			report.Refused = append(report.Refused, facetwiki.WikiLoss{
				Page: rel,
				What: "path",
				Why:  err.Error(),
			})
			continue
		}
		if replaced {
			replacedExisting = append(replacedExisting, path)
		}
		page := written[rel]
		page.Path = path
		report.Pages = append(report.Pages, page)
	}
	report.Refused = append(report.Refused, out.Report.Refused...)

	// Said once per page that was already there, rather than once per run
	// (the same choice the in-process adapter makes for a direct
	// wiki.ImportWiki call) — the report is read per page, and a single line
	// at the top is a line somebody scrolls past.
	for _, rel := range replacedExisting {
		report.Lost = append(report.Lost, facetwiki.WikiLoss{
			Page: rel,
			What: "local edits",
			Why:  facetwiki.ConfluenceRepeatedImportWarning,
		})
	}

	sort.Slice(report.Pages, func(i, j int) bool { return report.Pages[i].Path < report.Pages[j].Path })
	sort.Slice(report.Lost, func(i, j int) bool {
		if report.Lost[i].Page != report.Lost[j].Page {
			return report.Lost[i].Page < report.Lost[j].Page
		}
		return report.Lost[i].Why < report.Lost[j].Why
	})
	sort.Slice(report.Refused, func(i, j int) bool { return report.Refused[i].Page < report.Refused[j].Page })
	return report, out.Calls, nil
}

// runConfluenceMirror hands the wiki's pages to the sidecar and saves what it
// reports pushing.
//
// Unlike an import, a mirror has nothing left for the host to write — the
// pages already exist as files, and what the sidecar sends back is a report
// and a state to persist, not content.
func runConfluenceMirror(ctx context.Context, reg facet.Registry, wikiDir, space string) (facetwiki.WikiMirrorReport, int, error) {
	broker, err := confluenceBroker()
	if err != nil {
		return facetwiki.WikiMirrorReport{}, 0, err
	}
	defer broker.StopAll()

	wiki, err := facetwiki.LoadWiki(wikiDir)
	if err != nil {
		return facetwiki.WikiMirrorReport{}, 0, err
	}
	target := confluenceSourceName + ":" + space
	state, err := facetwiki.LoadWikiMirrorState(wikiDir, target)
	if err != nil {
		return facetwiki.WikiMirrorReport{}, 0, err
	}

	// The second-target refusal happens here, on the host, before the sidecar
	// is ever called. state.DisplacedTarget is
	// json:"-" on WikiMirrorState — deliberately not serialised, because it
	// describes a fact about this load, not the file — so marshalling state
	// into args below would silently drop it, and the sidecar's own check in
	// ConfluenceSource.Mirror (adapter.go) would never see a displaced target
	// and would never fire. Refusing before the call means a second-target
	// mirror pushes zero pages and leaves the state file untouched.
	if state.DisplacedTarget != "" && state.DisplacedTarget != target {
		return facetwiki.WikiMirrorReport{}, 0, fmt.Errorf(
			"the state records %q, this run targets %q — one wiki mirrors to one target, "+
				"and replacing the state would push every page to the first target again on its next run",
			state.DisplacedTarget, target)
	}

	var offered []facetwiki.WikiMirrorPage
	var skipped []string
	for _, page := range wiki.Pages {
		if page.Front.Mirror != nil && page.Front.Mirror.Skip {
			skipped = append(skipped, page.Path)
			continue
		}
		pageSpace := ""
		if page.Front.Mirror != nil {
			pageSpace = page.Front.Mirror.Space
		}
		offered = append(offered, facetwiki.WikiMirrorPage{
			Path:    page.Path,
			Address: page.Address(),
			Title:   page.Front.Title,
			Body:    page.Body,
			Digest:  page.Digest(),
			Space:   pageSpace,
		})
	}

	args, err := json.Marshal(struct {
		Space string                     `json:"space"`
		Pages []facetwiki.WikiMirrorPage `json:"pages"`
		State *facetwiki.WikiMirrorState `json:"state"`
	}{Space: space, Pages: offered, State: state})
	if err != nil {
		return facetwiki.WikiMirrorReport{}, 0, err
	}
	reply, err := broker.Call(ctx, "wiki", "confluence.mirror", args)
	if err != nil {
		return facetwiki.WikiMirrorReport{}, 0, err
	}
	if reply.Error != "" {
		// The sidecar's own refusal — see the same
		// check in runConfluenceImport above for why reply.Error must be read
		// before reply.Result is decoded.
		//
		// Blocker 3: a mirror that failed partway through still carries the
		// state it accumulated before failing (replyErrorWithState in
		// main.go) — decoded here and saved BEFORE the error is surfaced, so
		// the pages that already landed are not orphaned on the next run.
		// Result may be empty (an argument error never reached src.Mirror at
		// all), so a decode failure here is not itself reported: the run's
		// own error is still the one that matters.
		var partial confluenceMirrorReply
		if len(reply.Result) > 0 && json.Unmarshal(reply.Result, &partial) == nil &&
			partial.State != nil && len(partial.State.Entries) > 0 {
			if saveErr := facetwiki.SaveWikiMirrorState(wikiDir, partial.State); saveErr != nil {
				return partial.Report, partial.Calls, saveErr
			}
		}
		return facetwiki.WikiMirrorReport{}, 0, fmt.Errorf("confluence.mirror: %s", reply.Error)
	}
	var out confluenceMirrorReply
	if unmarshalErr := json.Unmarshal(reply.Result, &out); unmarshalErr != nil {
		return facetwiki.WikiMirrorReport{}, 0, fmt.Errorf("confluence.mirror: bad reply: %w", unmarshalErr)
	}
	out.Report.Skipped = append(out.Report.Skipped, skipped...)

	// The same rule wiki.MirrorWiki applies host-side (see its own comment):
	// the state is saved whenever it holds an entry, independent of whether
	// the run itself came back with an error, so a run that fails partway
	// resumes rather than repeating what already succeeded.
	if out.State != nil && len(out.State.Entries) > 0 {
		if saveErr := facetwiki.SaveWikiMirrorState(wikiDir, out.State); saveErr != nil {
			return out.Report, out.Calls, saveErr
		}
	}
	return out.Report, out.Calls, nil
}

// newWikiImportCmd brings a Confluence space, page or subtree in.
//
// It prints the report rather than a page count, because the report is the
// deliverable: an import is lossy, and a command that said "48 pages" would hide
// exactly the thing somebody has to act on.
func newWikiImportCmd() *cobra.Command {
	var registry, branch string
	var asJSON, noCommit bool

	cmd := &cobra.Command{
		Use:   "import <source> <ref>",
		Short: "Bring pages in from another system, on a branch, and report what was lost",
		Long: `Writes .md files on a branch and reports, per page, what did not come across.

The import uses a separate branch and worktree so it does not overwrite
uncommitted work in the current checkout. Review the resulting changes before
merging them into the wiki's default branch.

The branch is --branch, defaulting to one named after the reference. It is
created if it is not there and resumed if it is, and the default branch is
refused outright. With --no-commit, or if committing fails, the worktree stays
available at the reported path. With --json, these receipts go to stderr.

Confluence runs in the wiki plugin's sidecar process. It connects using
CONFLUENCE_URL, CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN from its allowed
environment. An installed plugin needs the corresponding tool and environment
grants; see 'facet plugin add --help'.

The sidecar must have a verified checksum before it can start. Install a wiki
plugin package with 'facet plugin add <source>', or use the combined Atlas
application built with measured bundled sidecars. For a source build, follow
Atlas's build instructions; the headless Core binary does not bundle a sidecar.

A reference is a space ('confluence:ENG'), a page ('confluence:4711'), a page
and its children ('confluence:4711+'), or the page's own URL.

An import is one direction and once. It is not a connection: after it runs the
wiki is the origin, and a Confluence address in 'aliases' says where a page used
to be reachable, never that it is still maintained there. Running it again
overwrites what was edited here, and says so.`,
		Args: cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			if args[0] != confluenceSourceName {
				return fmt.Errorf("no source named %q — this build knows %q",
					args[0], confluenceSourceName)
			}
			reg, err := wikiRegistry(cmd, registry)
			if err != nil {
				return err
			}

			// The worktree, not the checkout. Opened before the first request,
			// so a run that cannot get a branch has not already spent the API
			// calls — and so the refusal a person sees is about the branch
			// rather than about page 30 of 48.
			session, err := facetwiki.OpenWikiBranch(reg, importBranch(branch, args[1]))
			if err != nil {
				return err
			}
			keepWorktree := false
			receipts := cmd.OutOrStdout()
			if asJSON {
				receipts = cmd.ErrOrStderr()
			}
			defer func() {
				if keepWorktree {
					fmt.Fprintf(receipts, "uncommitted import retained on branch %s at %s\n", session.Branch, session.Dir)
					return
				}
				_ = session.Close()
			}()

			report, calls, err := runConfluenceImport(cmd.Context(), reg, session.WikiDir, args[1])
			if err != nil {
				return err
			}

			keepWorktree = len(report.Pages) > 0
			if keepWorktree && !noCommit {
				paths := make([]string, 0, len(report.Pages))
				for _, page := range report.Pages {
					paths = append(paths, page.Path)
				}
				commit, commitErr := session.Commit(
					fmt.Sprintf("wiki: import %s from %s", args[1], args[0]), paths)
				if commitErr != nil {
					return commitErr
				}
				keepWorktree = false
				defer fmt.Fprintf(receipts,
					"\ncommitted %d file(s) as %s on branch %s\n"+
						"  open a pull request from it — the import is reviewed before it is wiki content\n",
					len(commit.Files), commit.SHA, session.Branch)
			}
			if asJSON {
				enc := json.NewEncoder(cmd.OutOrStdout())
				enc.SetIndent("", "  ")
				return enc.Encode(report)
			}
			printImportReport(cmd.OutOrStdout(), report, calls)
			return nil
		},
	}
	cmd.Flags().StringVar(&registry, "registry", "", "which registry's wiki (default: the first declared)")
	cmd.Flags().BoolVar(&asJSON, "json", false, "emit the report as JSON")
	cmd.Flags().StringVar(&branch, "branch", "", "the branch to import onto (default: one named after the reference)")
	cmd.Flags().BoolVar(&noCommit, "no-commit", false, "write the files on the branch but do not commit them")
	return cmd
}

// importBranch is the branch an import writes on.
//
// Derived from the reference rather than fixed, so two imports do not land on
// one branch and so the branch name says what is on it. The slug is the wiki's
// own, which is the rule that already governs every other name this project
// generates.
func importBranch(explicit, ref string) string {
	if explicit != "" {
		return explicit
	}
	slug := facetwiki.WikiSlug(ref)
	if slug == "" {
		slug = "import"
	}
	return "wiki/import-" + slug
}

// printImportReport prints the three lists, the unpleasant ones first.
func printImportReport(out io.Writer, report facetwiki.WikiImportReport, calls int) {
	if len(report.Refused) > 0 {
		fmt.Fprintf(out, "refused — the write path would not take these:\n")
		for _, loss := range report.Refused {
			fmt.Fprintf(out, "  %s\n      %s\n", loss.Page, loss.Why)
		}
		fmt.Fprintln(out)
	}
	if len(report.Lost) > 0 {
		fmt.Fprintf(out, "lost — what did not come across:\n")
		for _, loss := range report.Lost {
			fmt.Fprintf(out, "  %s · %s\n      %s\n", loss.Page, loss.What, loss.Why)
		}
		fmt.Fprintln(out)
	}
	fmt.Fprintf(out, "written:\n")
	for _, page := range report.Pages {
		fmt.Fprintf(out, "  %s\n", page.Path)
		if page.RenamedFrom != "" {
			fmt.Fprintf(out, "      renamed from %q; the old address is in 'aliases'\n", page.RenamedFrom)
		}
	}
	fmt.Fprintf(out, "\n%d page(s), %d loss(es), %d refusal(s) — %d API call(s)\n",
		len(report.Pages), len(report.Lost), len(report.Refused), calls)
}

// newWikiMirrorCmd pushes wiki pages out to a Confluence space.
func newWikiMirrorCmd() *cobra.Command {
	var registry, to, space string
	var asJSON bool

	cmd := &cobra.Command{
		Use:   "mirror --to=confluence --space=KEY",
		Short: "Push the wiki's pages out again, refusing what changed on the far side",
		Long: `One direction, repeatable, with conflict detection and no conflict
resolution: push what moved, refuse what moved over there, report it, let a
person decide. There is no merge — git is the one merge algorithm, and a second
beside it would leave the wiki with two states and no tie-break.

The hierarchy goes too: an area's index.md becomes the parent page and the pages
beside it become its children.

One wiki mirrors to one target. A second space is refused rather than quietly
resetting the first one's digests.

Confluence runs in the wiki plugin's sidecar process, with the same verified
checksum and environment requirements as 'facet wiki import confluence'.
Install a wiki plugin package with 'facet plugin add <source>', or use the
combined Atlas application built with measured bundled sidecars.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if to != confluenceSourceName {
				return fmt.Errorf("no target named %q — this build knows %q",
					to, confluenceSourceName)
			}
			if space == "" {
				return fmt.Errorf("--space is required: a mirror needs a space to push into")
			}
			reg, err := wikiRegistry(cmd, registry)
			if err != nil {
				return err
			}
			report, calls, err := runConfluenceMirror(cmd.Context(), reg, facetwiki.WikiDir(reg), space)
			if err != nil {
				return err
			}
			if asJSON {
				enc := json.NewEncoder(cmd.OutOrStdout())
				enc.SetIndent("", "  ")
				return enc.Encode(report)
			}
			printMirrorReport(cmd.OutOrStdout(), report, calls)
			return nil
		},
	}
	cmd.Flags().StringVar(&registry, "registry", "", "which registry's wiki (default: the first declared)")
	cmd.Flags().StringVar(&to, "to", confluenceSourceName, "which system to push to")
	cmd.Flags().StringVar(&space, "space", "", "the Confluence space key to push into (required)")
	cmd.Flags().BoolVar(&asJSON, "json", false, "emit the report as JSON")
	return cmd
}

func printMirrorReport(out io.Writer, report facetwiki.WikiMirrorReport, calls int) {
	if len(report.Conflicts) > 0 {
		fmt.Fprintf(out, "conflicts — not overwritten, a person decides:\n")
		for _, conflict := range report.Conflicts {
			fmt.Fprintf(out, "  %s", conflict.Page)
			if conflict.RemoteID != "" {
				fmt.Fprintf(out, " · confluence page %s", conflict.RemoteID)
			}
			fmt.Fprintf(out, "\n      %s\n", conflict.Why)
		}
		fmt.Fprintln(out)
	}
	fmt.Fprintf(out, "%d pushed · %d unchanged · %d skipped · %d conflict(s) — %d API call(s)\n",
		len(report.Pushed), len(report.Unchanged), len(report.Skipped), len(report.Conflicts), calls)
}
