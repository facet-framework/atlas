package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/facet-framework/atlas/backend/internal/catalogue"
	"github.com/facet-framework/atlas/backend/server"
	"github.com/facet-framework/core/cli"
	"github.com/facet-framework/core/registry"
	"github.com/spf13/cobra"
)

// newUIServer wires the registry, Companion and shared plugin storage into
// the reader served by the CLI.
func newUIServer(reg facet.Registry, companion *server.Companion, testReport string) *server.Server {
	server := &server.Server{
		Registry:   reg,
		Companion:  companion,
		TestReport: testReport,
		PluginsDir: cli.PluginsDir(),
		MCPTools: func(ctx context.Context) ([]string, error) {
			cfg, err := facet.LoadConfigWithResolvedSourceView(reg.Root, reg.SourceView)
			if err != nil {
				return nil, err
			}
			return cli.MCPToolNames(ctx, facet.RegistrySet(cfg.All()), cli.PluginsDir(), version)
		},
	}
	catalogue.Configure(server)
	return server
}

// newCompanion uses the same plugin storage as the reader, so both resolve
// installed tools and grants from the same location.
func newCompanion(root, model, bin string) *server.Companion {
	return &server.Companion{
		Root:       root,
		Model:      model,
		Bin:        bin,
		PluginsDir: cli.PluginsDir(),
	}
}

// otherRegistries names the declared registries this reader does not serve.
// One server reads one registry, and without '--registry' that is the first
// declared one, so a project with several says which others exist and how to
// open them rather than leaving the choice invisible.
func otherRegistries(cfg *facet.Config, served string) string {
	var others []string
	for _, name := range cfg.Names() {
		if name != served {
			others = append(others, name)
		}
	}
	if len(others) == 0 {
		return ""
	}
	return strings.Join(others, ", ") + " (open with --registry <name>)"
}

// newUICmd wires the reader into the command surface.
func newUICmd() *cobra.Command {
	var port int
	var noOpen bool
	var registry string
	var record string
	var companionModel string
	var companionBin string
	var testReport string

	cmd := &cobra.Command{
		Use:   "ui",
		Short: "Read this repository's FACET registry in a browser",
		Long: `Starts FACET Atlas, reads the registry configured in '` + facet.ConfigName + `',
scans the source tree for '@facet:' anchors, and opens the browser reader.

Atlas is one surface with three depths — register, record, promise — measuring
the offset between what a record promises and what the code proves. It also
asks who is reading: seven roles, from 'Leadership', which names no schema term,
to 'Agent', which is raw JSON and endpoints, each rebuild the page around what
that reader came for.

The reading is streamed while it happens, so a large repository shows which file
it is on rather than a spinner. Reloading the page reads the repository again,
which is how the view stays current while you edit.

Leave it running for as long as you want to read; Ctrl-C stops it. An agent
should start it in the background and report the address it prints.

'--record' opens straight at one record. The id ends up in the address, so the
address that opens is the address to share.`,
		RunE: func(cmd *cobra.Command, args []string) error {

			cfg, err := cli.ConfigForCommand(cmd)
			if err != nil {
				return err
			}
			reg, err := cfg.Select(registry)
			if err != nil {
				return err
			}
			if !reg.Adopted() {
				return fmt.Errorf("this project has no FACET records under %s — add records there or use --root to select a project with records", reg.Rel(reg.RecordsDir))
			}

			if record != "" && !recordIDRe.MatchString(record) {
				return fmt.Errorf("%q is not a record id — expected three lowercase segments, as in tasks/create/quick-add", record)
			}

			listener, err := server.Listen(port)
			if err != nil {
				return err
			}

			// The reader keeps the open record in the fragment, so the address
			// that opens is the address that can be shared.
			address := fmt.Sprintf("http://%s/", listener.Addr().String())
			if record != "" {
				address += "#" + record
			}
			fmt.Fprintln(cmd.OutOrStdout(), "FACET Atlas:", address)
			fmt.Fprintln(cmd.OutOrStdout(), "Reading:    ", reg.Root)
			if reg.Name != "" {
				fmt.Fprintln(cmd.OutOrStdout(), "Registry:   ", reg.Name)
			}
			if others := otherRegistries(cfg, reg.Name); others != "" {
				fmt.Fprintln(cmd.OutOrStdout(), "Not shown:  ", others)
			}
			if record != "" {
				fmt.Fprintln(cmd.OutOrStdout(), "Record:     ", record)
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Stop with Ctrl-C.")

			if !noOpen {
				openBrowser(address)
			}

			companion := newCompanion(reg.Root, companionModel, companionBin)
			if err := companion.Available(); err != nil {
				// Not fatal: the reader is worth opening without it, and the
				// window says so itself rather than failing on the first question.
				fmt.Fprintln(cmd.OutOrStdout(), "Companion:   unavailable —", err)
			}

			reader := newUIServer(reg, companion, testReport)

			defer reader.StopPlugins()

			server := &http.Server{
				Handler: reader.Handler(),
				// No write timeout: the corpus stream stays open for as long as
				// the page is being read, and a deadline would cut it off
				// mid-scan on a large repository.
				ReadHeaderTimeout: 10 * time.Second,
			}

			ctx, stop := signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)
			defer stop()

			errc := make(chan error, 1)
			go func() { errc <- server.Serve(listener) }()

			select {
			case err := <-errc:
				if errors.Is(err, http.ErrServerClosed) {
					return nil
				}
				return err
			case <-ctx.Done():
				shutdown, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				_ = server.Shutdown(shutdown)
				fmt.Fprintln(cmd.OutOrStdout())
				return nil
			}
		},
	}

	cmd.Flags().IntVar(&port, "port", 7317, "port to listen on; a taken port falls back to one the system picks")
	cmd.Flags().BoolVar(&noOpen, "no-open", false, "do not open a browser, only print the address")
	cmd.Flags().StringVar(&registry, "registry", "", "registry to read (default: the first declared in "+facet.ConfigName+")")
	cmd.Flags().StringVar(&record, "record", "", "open straight at this record id, e.g. tasks/create/quick-add")
	cmd.Flags().StringVar(&companionModel, "companion-model", "", "model the companion answers with (default: whatever Claude Code is set to)")
	cmd.Flags().StringVar(&testReport, "test-report", "", "a 'facet test --json' report to read; shown only while it was measured on the current commit of a clean tree")
	cmd.Flags().StringVar(&companionBin, "companion-bin", "", "Claude Code executable for the companion (default: claude on PATH)")
	return cmd
}

// recordIDRe is the id grammar the reader will accept in an address. Checking
// it here turns a typo into a sentence instead of a reader that opens on the
// overview and leaves the reason to guesswork.
var recordIDRe = regexp.MustCompile(`^[a-z][a-z0-9-]*(/[a-z][a-z0-9-]*){2}$`)

// openBrowser asks the desktop to open an address.
func openBrowser(address string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", address)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", address)
	default:
		cmd = exec.Command("xdg-open", address)
	}
	if err := cmd.Start(); err != nil {
		return
	}
	go func() { _ = cmd.Wait() }()
}
