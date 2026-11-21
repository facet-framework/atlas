package main

import (
	"context"
	"github.com/facet-framework/atlas/backend/server"
	"github.com/facet-framework/core/cli"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/facet-framework/core/registry"
)

func TestTheShippedReaderIsPointedAtAPluginDirectory(t *testing.T) {
	t.Setenv("FACET_PLUGINS_DIR", "")
	t.Setenv("XDG_DATA_HOME", t.TempDir())

	server := newUIServer(facet.Registry{}, nil, "")

	if server.PluginsDir == "" {
		t.Fatal("the reader the binary serves has no plugin directory")
	}
	if !strings.HasSuffix(filepath.ToSlash(server.PluginsDir), "facet/plugins") {
		t.Errorf("the reader was pointed somewhere unexpected: %q", server.PluginsDir)
	}
}

func TestThePluginDirectoryIsNotInTheRepositoryBeingRead(t *testing.T) {
	home := t.TempDir()
	t.Setenv("FACET_PLUGINS_DIR", "")
	t.Setenv("XDG_DATA_HOME", home)

	dir := cli.PluginsDir()
	repo := filepath.Join(home, "project")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatal(err)
	}
	server := newUIServer(facet.Registry{Root: repo}, nil, "")
	relative, err := filepath.Rel(repo, server.PluginsDir)
	if err != nil {
		t.Fatal(err)
	}
	if relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		t.Fatalf("shipped reader's plugins directory %q is inside actual served repository %q", server.PluginsDir, repo)
	}

	if !strings.HasPrefix(dir, home) {
		t.Fatalf("the plugin directory %q is not under XDG_DATA_HOME %q", dir, home)
	}
}

// The route answers from a lister the command must wire. Drop MCPTools from
// newUIServer and the endpoint says "no MCP server to ask" while go build stays
// green.
func TestTheShippedReaderListsTheRealMCPTools(t *testing.T) {
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	server := newUIServer(facet.Registry{Root: t.TempDir()}, nil, "")

	if server.MCPTools == nil {
		t.Fatal("the reader the binary serves has no way to list MCP tools")
	}
	names, err := server.MCPTools(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range names {
		if n == "feature_find" {
			return
		}
	}
	t.Fatalf("feature_find missing from %v", names)
}

// Named mutation: delete `TestReport: testReport` from newUIServer. The flag
// then never reaches the server; the route answers "none" for a real report
// and this turns red.
func TestTheTestReportFlagReachesTheServedRoute(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "report.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := newUIServer(facet.Registry{Root: root}, nil, path)
	if srv.TestReport != path {
		t.Fatalf("the report path did not reach the server: %q", srv.TestReport)
	}
	rec := httptest.NewRecorder()
	// A loopback Host: the reader refuses any other in front of every route.
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+server.TestReportPath, nil)
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	srv.Handler().ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), `"unreadable"`) {
		t.Fatalf("the route did not judge the report the flag named: %s", rec.Body.String())
	}
}
