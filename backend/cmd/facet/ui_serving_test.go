package main

import (
	"context"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/facet-framework/atlas/backend/server"
)

type atlasPrintedAddress struct{ ready chan string }

func (w atlasPrintedAddress) Write(p []byte) (int, error) {
	if strings.Contains(string(p), "FACET Atlas:") {
		address := regexp.MustCompile(`http://127\.0\.0\.1:[0-9]+/`).FindString(string(p))
		if address != "" {
			select {
			case w.ready <- address:
			default:
			}
		}
	}
	return len(p), nil
}

func TestUIPrintsTheActualServingAddressIncludingAPortFallback(t *testing.T) {
	t.Setenv("PATH", t.TempDir()) // An embedded reader must not need Node or Git to start.
	for _, busy := range []bool{false, true} {
		t.Run(map[bool]string{false: "free", true: "busy"}[busy], func(t *testing.T) {
			root := t.TempDir()
			record := filepath.Join(root, "docs/facets/features/demo/thing/widget.yaml")
			if err := os.MkdirAll(filepath.Dir(record), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(record, []byte("schema_version: \"0.1\"\nid: demo/thing/widget\nlifecycle: active\nintent:\n  summary: Printed address project.\ncontract:\n  scenarios:\n    - id: visible\n      statement: Given a When b Then c\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			tree := func() map[string]string {
				entries := map[string]string{}
				err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
					if err != nil {
						return err
					}
					relative, err := filepath.Rel(root, path)
					if err != nil {
						return err
					}
					if entry.IsDir() {
						entries[relative] = "directory"
						return nil
					}
					body, err := os.ReadFile(path)
					if err != nil {
						return err
					}
					entries[relative] = "file:" + string(body)
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
				return entries
			}
			before := tree()
			port := "0"
			if busy {
				blocker, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				defer blocker.Close()
				_, port, err = net.SplitHostPort(blocker.Addr().String())
				if err != nil {
					t.Fatal(err)
				}
			}
			cmd := newRootCmd()
			writer := atlasPrintedAddress{ready: make(chan string, 1)}
			cmd.SetOut(writer)
			cmd.SetErr(writer)
			cmd.SetArgs([]string{"ui", "--root", root, "--no-open", "--port", port, "--companion-bin", filepath.Join(root, "no-agent")})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- cmd.ExecuteContext(ctx) }()
			defer func() {
				cancel()
				select {
				case err := <-done:
					if err != nil {
						t.Error(err)
					}
				case <-time.After(3 * time.Second):
					t.Error("reader did not stop after context cancellation")
				}
			}()
			var address string
			select {
			case address = <-writer.ready:
			case err := <-done:
				t.Fatalf("reader exited before printing its address: %v", err)
			case <-time.After(5 * time.Second):
				t.Fatal("reader did not print its serving address")
			}
			target, err := url.Parse(address)
			if err != nil {
				t.Fatal(err)
			}
			if target.Hostname() != "127.0.0.1" {
				t.Fatalf("printed non-loopback address %q", address)
			}
			if busy && target.Port() == port {
				t.Fatal("fallback printed the occupied port")
			}
			client := http.Client{Timeout: 2 * time.Second}
			for _, path := range []string{"", "api/corpus", "api/companion/state"} {
				req, err := http.NewRequest(http.MethodGet, address+path, nil)
				if path != "" {
					req.Header.Set("Sec-Fetch-Site", "same-origin")
				}
				response, err := client.Do(req)
				if err != nil {
					t.Fatalf("printed address does not serve: %v", err)
				}
				body, err := io.ReadAll(response.Body)
				response.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
				if response.StatusCode != http.StatusOK {
					t.Fatalf("%s returned %d", path, response.StatusCode)
				}
				if path == "" {

					if os.Getenv("FACET_REQUIRE_UI") != "" && !server.ReaderBuilt() {
						t.Fatal("FACET_REQUIRE_UI is set but the binary embeds no built reader; run 'sh scripts/sync-server.sh --build'")
					}
					embedded, err := fs.ReadFile(server.Assets(), "index.html")
					if err != nil {
						t.Fatal(err)
					}
					if string(body) != string(embedded) {
						t.Fatal("printed address does not serve embedded reader")
					}
					if server.ReaderBuilt() && !strings.Contains(string(body), "<title>FACET Atlas</title>") {
						t.Fatal("the embedded reader is not the Atlas page")
					}
				}
				if path == "api/corpus" && (!strings.Contains(string(body), "demo/thing/widget") || !strings.Contains(string(body), "Printed address project.")) {
					t.Fatal("printed address does not stream the served project's records")
				}
				if path == "api/companion/state" && (!strings.Contains(string(body), `"available":false`) || !strings.Contains(string(body), "Install Claude Code")) {
					t.Fatalf("missing companion state does not carry its install hint: %s", body)
				}
			}
			if !reflect.DeepEqual(before, tree()) {
				t.Fatal("starting and reading Atlas wrote to the repository")
			}
		})
	}
}
