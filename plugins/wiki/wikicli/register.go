package wikicli

import (
	"fmt"
	"os"
	"path"

	facetwiki "github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
	"github.com/facet-framework/core/cli"
	"github.com/facet-framework/core/cli/scaffold"
	"github.com/facet-framework/core/registry"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/spf13/cobra"
)

// The wiki's command surface, its MCP tools and its setup row, for a build
// that links the wiki. Core links none of this package.

// NewCommand is the 'facet wiki' command tree, a fresh instance per call.
func NewCommand() *cobra.Command { return newWikiCmd() }

// mcpHelp is the paragraph 'facet mcp --help' carries for the wiki's tools.
const mcpHelp = `The wiki — the prose beside the registry — has its own eleven: wiki_find,
wiki_get, wiki_create, wiki_write, wiki_set_tags, wiki_set_category,
wiki_set_records, wiki_set_status, wiki_move, wiki_commit, wiki_propose and
wiki_check. They write, and what they refuse is the specification: never a path
outside the wiki directory, never a .yaml of any kind, never the default branch,
never a commit of anything the host did not itself write, and there is no tool
that deletes a page or merges a proposal.`

func init() {
	cli.RegisterMCPTools(cli.MCPToolset{
		Add:  func(server *mcp.Server, set facet.RegistrySet) { addWikiTools(server, set) },
		Help: mcpHelp,
	})
	cli.RegisterSetupCheck(cli.SetupCheck{ID: "wiki", Check: checkWiki})
	// 'facet init' of a build with the wiki writes the wiki schema beside the
	// Core schemas, so the lint judges a wiki.yaml the project adds later.
	scaffold.RegisterFile(scaffold.File{
		Path: path.Join(scaffold.RecordsDir, "schema", facetwiki.SchemaName),
		Data: facetwiki.Schema(),
	})
}

// checkWiki is the setup report's wiki row for one registry.
func checkWiki(reg facet.Registry) cli.SetupResult {
	evidence := "facet.CheckWiki on " + reg.Rel(facetwiki.WikiDir(reg))
	report, err := facetwiki.CheckWiki(reg, facetwiki.WikiCheckOptions{})
	if err != nil {
		return cli.SetupResult{State: cli.SetupUnmeasured, Finding: "cannot read the wiki: " + err.Error(), Evidence: evidence}
	}
	switch {
	case !report.Present:
		return cli.SetupResult{State: cli.SetupNotApplicable, Finding: "no wiki", Evidence: evidence}
	case report.Failed():
		return cli.SetupResult{State: cli.SetupRed, Finding: fmt.Sprintf("`facet wiki check` fails on %d page(s)", report.Checked.Pages), Evidence: evidence}
	}
	return cli.SetupResult{State: cli.SetupOK, Finding: fmt.Sprintf("%d page(s), the check passes", report.Checked.Pages), Evidence: evidence}
}

// silentError fails a command without printing anything further, for a
// command that has already reported in its own words; cli.Run honours it.
type silentError struct{}

func (silentError) Error() string { return "" }
func (silentError) Silent() bool  { return true }

var errSilent error = silentError{}

func readFileString(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
