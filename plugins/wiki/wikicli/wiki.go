package wikicli

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	facetwiki "github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
	"github.com/facet-framework/core/cli"
	"github.com/facet-framework/core/registry"
	"github.com/spf13/cobra"
)

// newWikiCmd is the wiki's command surface: the human's half and CI's half.
//
// Both halves call the same code the routes and the agent tools call. That is
// the point rather than an economy: a check that agreed with the reader only by
// coincidence would be a check nobody could act on, and a 'new' that wrote a
// header the reader could not read would be a second format.
func newWikiCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "wiki",
		Short: "Read, write and check the project's wiki",
		Long: `The prose beside the registry: Markdown pages under <records>/wiki/.

A page is not a record. A record is a promise the linter holds the code to; a
page is what somebody had to explain so the code makes sense. Nothing in a
record points at a page, no page is ever written as YAML, and 'facet lint' says
nothing about either — 'facet wiki check' is the wiki's own gate, and it is the
one CI runs.`,
	}
	cmd.AddCommand(newWikiListCmd(), newWikiCheckCmd(), newWikiNewCmd(), newWikiTagCmd(),
		newWikiImportCmd(), newWikiMirrorCmd())
	return cmd
}

// wikiRegistry resolves which registry's wiki a command means.
func wikiRegistry(cmd *cobra.Command, name string) (facet.Registry, error) {
	cfg, err := cli.ConfigForCommand(cmd)
	if err != nil {
		return facet.Registry{}, err
	}
	if name != "" {
		return cfg.Select(name)
	}
	return cli.RegistrySetForCommand(cmd).Primary(), nil
}

func newWikiListCmd() *cobra.Command {
	var asJSON bool
	var registry, area, category, tag string

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List the wiki's pages",
		Long: `Prints each page with its address, area and category.

What a page does not say is printed as not said. A page with no status is shown
with none rather than as 'maintained', and one never confirmed shows no date
rather than the date of its last commit — those measure something else.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			reg, err := wikiRegistry(cmd, registry)
			if err != nil {
				return err
			}
			wiki, err := facetwiki.LoadWiki(facetwiki.WikiDir(reg))
			if err != nil {
				return err
			}
			out := cmd.OutOrStdout()
			if !wiki.Present {
				// Said rather than printed as an empty list, because the two
				// mean opposite things.
				fmt.Fprintf(out, "this project has no wiki — %s does not exist\n", reg.Rel(facetwiki.WikiDir(reg)))
				return nil
			}

			pages := facetwiki.ListWikiPages(wiki, area, category, tag)
			if asJSON {
				enc := json.NewEncoder(out)
				enc.SetIndent("", "  ")
				return enc.Encode(pages)
			}
			for _, p := range pages {
				status := p.Status
				if status == "" {
					status = "no status stated"
				}
				fmt.Fprintf(out, "%s\n    %s · %s · %s\n", p.Address, p.Title, p.Area, status)
			}
			fmt.Fprintf(out, "\n%d page(s)\n", len(pages))
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "emit the listing as JSON")
	cmd.Flags().StringVar(&registry, "registry", "", "which registry's wiki (default: the first declared)")
	cmd.Flags().StringVar(&area, "area", "", "only pages in this area")
	cmd.Flags().StringVar(&area, facetwiki.LocalizedFlag("area"), "", "legacy alias of --area")
	_ = cmd.Flags().MarkHidden(facetwiki.LocalizedFlag("area"))
	cmd.Flags().StringVar(&category, "category", "", "only pages of this category")
	cmd.Flags().StringVar(&category, facetwiki.LocalizedFlag("category"), "", "legacy alias of --category")
	_ = cmd.Flags().MarkHidden(facetwiki.LocalizedFlag("category"))
	cmd.Flags().StringVar(&tag, "tag", "", "only pages carrying this tag")
	return cmd
}

func newWikiCheckCmd() *cobra.Command {
	var asJSON, strict bool
	var registry string

	cmd := &cobra.Command{
		Use:   "check",
		Short: "Check the wiki, as CI would",
		Long: `Two errors and a list of warnings.

  wiki-title       a page declaring no title — the file name is a slug, and a
                   heading in the body is prose rather than a declaration
  wiki-records     a 'records:' entry naming a record no registry holds, which
                   is the treatment an @facet: tag naming no record gets

Everything else is a warning: an undeclared area, a declared area with no page,
an unknown category, a page past the wiki's declared depth, a dead atlas:
reference, a path outside the address grammar, an embedding carrying a value
instead of a selector or naming a component that may not be embedded.

None of those is a broken repository. Prose pointing at a deleted page is a
maintenance signal, and a build that fails on one is a build people route
around. --strict promotes every warning to an error, for a project that wants
that and for nothing else — that is the project's decision, not the framework's.

A project with no wiki passes, because adoption is a decision and a check that
failed an unadopted project would make it a migration.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			reg, err := wikiRegistry(cmd, registry)
			if err != nil {
				return err
			}
			// Judged against every registry's records, not just this one's: ids
			// are global (the specification), so a page in a monorepo may legitimately name
			// a record another product holds.
			known := map[string]bool{}
			if registries, err := cli.AllRegistriesForCommand(cmd); err == nil {
				for _, r := range registries {
					if recs, err := r.LoadFeatures(); err == nil {
						for _, rec := range recs {
							known[rec.ID] = true
						}
					}
				}
			}

			report, err := facetwiki.CheckWiki(reg, facetwiki.WikiCheckOptions{Strict: strict, KnownIDs: known})
			if err != nil {
				return err
			}
			if asJSON {
				enc := json.NewEncoder(cmd.OutOrStdout())
				enc.SetIndent("", "  ")
				if err := enc.Encode(report); err != nil {
					return err
				}
			} else {
				printWikiReport(cmd.OutOrStdout(), reg, report)
			}
			if report.Failed() {
				// Returned rather than os.Exit'd, unlike 'facet lint' next
				// door: the exit belongs to main, and a command that kills the
				// process cannot be driven by a test — which for the one check
				// CI depends on is the wrong trade. The message is empty
				// because printWikiReport has already said everything, and
				// main prints whatever comes back here.
				return errSilent
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "emit findings as JSON")
	cmd.Flags().BoolVar(&strict, "strict", false, "treat every warning as an error")
	cmd.Flags().StringVar(&registry, "registry", "", "which registry's wiki (default: the first declared)")
	return cmd
}

func printWikiReport(out io.Writer, reg facet.Registry, r facetwiki.WikiReport) {
	if !r.Present {
		fmt.Fprintf(out, "this project has no wiki — %s does not exist\n", reg.Rel(facetwiki.WikiDir(reg)))
		return
	}
	var errs, warns int
	for _, f := range r.Findings {
		marker := "warning"
		if f.Severity == facet.SeverityError {
			marker = "error"
			errs++
		} else {
			warns++
		}
		fmt.Fprintf(out, "%s: %s: %s\n", marker, f.Path, f.Message)
		if f.Hint != "" {
			fmt.Fprintf(out, "       %s\n", f.Hint)
		}
	}
	fmt.Fprintf(out, "\n%d page(s), %d area(s) checked — %d error(s), %d warning(s)\n",
		r.Checked.Pages, r.Checked.Areas, errs, warns)
}

func newWikiNewCmd() *cobra.Command {
	var registry, area, group, category, summary, tags, records string

	cmd := &cobra.Command{
		Use:   "new \"Title\"",
		Short: "Write a new page's header and scaffold",
		Long: `Creates a page with the header keys filled in and a heading under them.

A file scaffold, not a template engine: it stops six people inventing six shapes
for a how-to, and stops well short of a language.

The new page carries 'status: draft' and no 'reviewed' date. A draft is what a
new page is, and nobody has confirmed it — writing today's date into 'reviewed'
would be the flattering value nobody measured.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			reg, err := wikiRegistry(cmd, registry)
			if err != nil {
				return err
			}
			if area == "" {
				return fmt.Errorf("--area is required: the folder a page lies in is its area, and there is no header key for it")
			}
			slug := facetwiki.WikiSlug(args[0])
			if slug == "" {
				return fmt.Errorf("%q does not reduce to a file name in the address grammar — pass a title with some letters in it", args[0])
			}
			rel := area + "/" + slug + facetwiki.WikiPageExt
			if group != "" {
				rel = area + "/" + group + "/" + slug + facetwiki.WikiPageExt
			}

			body := facetwiki.NewWikiPage(args[0], category, summary, splitList(records), splitList(tags))
			written, err := facetwiki.CreateWikiPage(reg, facetwiki.WikiDir(reg), rel, body)
			if err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "%s\n%s\n", reg.Rel(facetwiki.WikiDir(reg))+"/"+written, facetwiki.WikiAddress(written))
			return nil
		},
	}
	cmd.Flags().StringVar(&registry, "registry", "", "which registry's wiki (default: the first declared)")
	cmd.Flags().StringVar(&area, "area", "", "the area — the folder directly under wiki/ (required)")
	cmd.Flags().StringVar(&area, facetwiki.LocalizedFlag("area"), "", "legacy alias of --area")
	_ = cmd.Flags().MarkHidden(facetwiki.LocalizedFlag("area"))
	cmd.Flags().StringVar(&group, "group", "", "an optional group folder under the area")
	cmd.Flags().StringVar(&group, facetwiki.LocalizedFlag("group"), "", "legacy alias of --group")
	_ = cmd.Flags().MarkHidden(facetwiki.LocalizedFlag("group"))
	cmd.Flags().StringVar(&category, "category", "", "the page's category, from those wiki.yaml declares")
	cmd.Flags().StringVar(&category, facetwiki.LocalizedFlag("category"), "", "legacy alias of --category")
	_ = cmd.Flags().MarkHidden(facetwiki.LocalizedFlag("category"))
	cmd.Flags().StringVar(&summary, "summary", "", "the one line shown under the title in listings")
	cmd.Flags().StringVar(&tags, "tags", "", "comma-separated tags")
	cmd.Flags().StringVar(&records, "records", "", "comma-separated record ids this page is about")
	return cmd
}

// newWikiTagCmd edits a page's tags without rewriting the page.
//
// Its own command because it is the smallest thing anybody asks for, and
// because doing it by hand means opening a file and editing YAML in it — which
// is how a tag list acquires three spellings of one word.
func newWikiTagCmd() *cobra.Command {
	var registry string
	var add, remove string

	cmd := &cobra.Command{
		Use:   "tag <path>",
		Short: "Add or remove a page's tags, leaving everything else alone",
		Long: `Edits only the tag list. The body and every other header key are written
back byte for byte, so this is safe to run against a page somebody is editing —
a tool that rewrote the whole file to add one tag would discard whatever was
written beside it.

Removing the last tag removes the key, because absent is what "no tags" means
everywhere else in this header.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			reg, err := wikiRegistry(cmd, registry)
			if err != nil {
				return err
			}
			edited, err := facetwiki.EditWikiFront(reg, facetwiki.WikiDir(reg), args[0], facetwiki.WikiFrontEdit{
				AddTags:    splitList(add),
				RemoveTags: splitList(remove),
			})
			if err != nil {
				return err
			}
			if edited.Diff == "" {
				fmt.Fprintln(cmd.OutOrStdout(), "nothing changed")
				return nil
			}
			fmt.Fprint(cmd.OutOrStdout(), edited.Diff)
			return nil
		},
	}
	cmd.Flags().StringVar(&registry, "registry", "", "which registry's wiki (default: the first declared)")
	cmd.Flags().StringVar(&add, "add", "", "comma-separated tags to add")
	cmd.Flags().StringVar(&remove, "remove", "", "comma-separated tags to remove")
	return cmd
}

// splitList turns a comma-separated flag into a list, dropping the empties a
// trailing comma leaves behind.
func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
