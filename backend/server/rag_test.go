package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/facet-framework/core/rag"
	"github.com/facet-framework/core/registry"
)

// ragProject writes a one-record registry and, when asked, an index over it.
func ragProject(t *testing.T, indexed bool) facet.Registry {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, "docs", "facets", "features", "billing", "invoice", "dunning.yaml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	body := `id: billing/invoice/dunning
schema_version: "0.1"
lifecycle: active
intent:
  summary: Chases an unpaid invoice on a schedule, and stops the moment it is paid.
contract:
  scenarios:
    - id: a-paid-invoice-stops-the-schedule
      statement: |
        Given an invoice with a dunning schedule
        When the invoice is paid
        Then no further reminder is sent
`
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	reg := facet.Open(root)
	if indexed {
		store, err := rag.Build(context.Background(), []facet.Registry{reg}, &rag.LocalEmbedder{}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.Save(reg.RAGIndexPath()); err != nil {
			t.Fatal(err)
		}
	}
	return reg
}

func search(t *testing.T, reg facet.Registry, query string) RAGResponse {
	t.Helper()
	server := &Server{Registry: reg, Assets: os.DirFS(t.TempDir())}
	req := loopbackRequest(http.MethodGet, RAGPath+"?q="+query, nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body RAGResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unreadable response %q: %v", rec.Body.String(), err)
	}
	return body
}

func TestSearchIndexReturnsCitedHits(t *testing.T) {
	body := search(t, ragProject(t, true), "unpaid+invoice+reminder+schedule")

	if !body.Available {
		t.Fatalf("the index exists but the reader was told otherwise: %+v", body)
	}
	if len(body.Hits) == 0 {
		t.Fatal("no hits over a record that plainly matches")
	}
	for _, hit := range body.Hits {
		if hit.Path == "" {
			t.Fatal("a hit with no file is a claim nobody can check")
		}
		if hit.Feature != "billing/invoice/dunning" {
			t.Fatalf("a hit named a feature the project does not have: %q", hit.Feature)
		}
		if hit.Text == "" {
			t.Fatal("a hit must carry the text it matched, so the reader sees it rather than a score")
		}
	}
	if !body.Lexical {
		t.Fatal("an index built by the local embedder must say so — it matches words, not meaning")
	}
}

// A project with no index is told what to type. A 404 would be true and useless.
func TestSearchIndexSaysHowToBuildOne(t *testing.T) {
	body := search(t, ragProject(t, false), "anything")

	if body.Available {
		t.Fatal("there is no index; the reader must not be told there is")
	}
	if !strings.Contains(body.Hint, "facet rag index") {
		t.Fatalf("the hint must carry the command, got %q", body.Hint)
	}
	if body.Hits == nil {
		t.Fatal("hits must be an empty list rather than null, so the reader needs no special case")
	}
}

// A host message follows the reader's language: the wire carries a stable code
// beside each English sentence the host writes itself. Read off the raw JSON,
// not the Go type, so a renamed or missing tag shows up here.
func TestSearchIndexSendsCodesBesideItsOwnSentences(t *testing.T) {
	server := &Server{Registry: ragProject(t, false), Assets: os.DirFS(t.TempDir())}
	for _, tc := range []struct{ query, field, code string }{
		{"anything", "reasonCode", "rag.no-index"},
		{"anything", "hintCode", "rag.build-index"},
		{"", "reasonCode", "rag.no-question"},
	} {
		req := loopbackRequest(http.MethodGet, RAGPath+"?q="+tc.query, nil)
		rec := httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, req)
		var raw map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
			t.Fatalf("unreadable response %q: %v", rec.Body.String(), err)
		}
		if raw[tc.field] != tc.code {
			t.Fatalf("q=%q: %s = %v, expected %q in %s", tc.query, tc.field, raw[tc.field], tc.code, rec.Body)
		}
		if raw["reason"] == "" || raw["reason"] == nil {
			t.Fatalf("q=%q: the English text beside the code is missing: %s", tc.query, rec.Body)
		}
	}
}

func TestSearchIndexRefusesAForeignOrigin(t *testing.T) {
	server := &Server{Registry: ragProject(t, true), Assets: os.DirFS(t.TempDir())}
	req := loopbackRequest(http.MethodGet, RAGPath+"?q=x", nil)
	req.Header.Set("Origin", "https://example.com")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("a foreign origin must be refused, got %d", rec.Code)
	}
}

// The retrieval tool is offered only where there is something to retrieve from.
// A tool in the permission list that can only ever fail teaches the agent to
// try it and teaches the reader nothing.
func TestCompanionOffersRetrievalOnlyWithAnIndex(t *testing.T) {
	without := &Companion{Root: ragProject(t, false).Root}
	if strings.Contains(without.tools(), ragToolName) {
		t.Fatalf("a project with no index must not offer the tool: %s", without.tools())
	}
	if without.ragConfig() != "" {
		t.Fatal("a project with no index must not start an MCP server")
	}

	with := &Companion{Root: ragProject(t, true).Root}
	if !strings.Contains(with.tools(), ragToolName) {
		t.Fatalf("a project with an index must offer the tool: %s", with.tools())
	}
	for _, keep := range []string{"Read", "Grep", "Glob"} {
		if !strings.Contains(with.tools(), keep) {
			t.Fatalf("%s was lost from the permission list: %s", keep, with.tools())
		}
	}

	config := with.ragConfig()
	if config == "" {
		t.Fatal("a project with an index must configure the retrieval server")
	}
	var parsed struct {
		Servers map[string]struct {
			Command string   `json:"command"`
			Args    []string `json:"args"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal([]byte(config), &parsed); err != nil {
		t.Fatalf("the MCP config is not valid JSON: %v", err)
	}
	server, ok := parsed.Servers[ragServerName]
	if !ok {
		t.Fatalf("no %q server in %s", ragServerName, config)
	}
	if server.Command == "" {
		t.Fatal("the server must name an executable")
	}
	if len(server.Args) < 1 || server.Args[0] != "mcp" {
		t.Fatalf("the server must run 'facet mcp', got %v", server.Args)
	}
	// Rooted at the repository being read, not at wherever the process was
	// started, or the companion would search a different project's registry.
	if server.Args[len(server.Args)-1] != with.Root {
		t.Fatalf("the server must be rooted at %s, got %v", with.Root, server.Args)
	}
}

// A retrieval call is reported like a read, so the reader shows the search
// happening rather than a silent gap before the answer.
func TestRetrievalIsReportedAsAStep(t *testing.T) {
	if !isReadTool(ragToolName) {
		t.Fatal("a retrieval call must be reported")
	}
	line := `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"` + ragToolName +
		`","input":{"query":"convention for naming scenario ids"}}]}}`
	steps := decodeStreamLine([]byte(line), "/repo")
	if len(steps) != 1 {
		t.Fatalf("want one step, got %d", len(steps))
	}
	if steps[0].Kind != "read" || steps[0].Tool != ragToolName {
		t.Fatalf("wrong step: %+v", steps[0])
	}
	// The query, not a file path: nothing was opened, and showing a file would
	// say something was.
	if steps[0].Target != "convention for naming scenario ids" {
		t.Fatalf("the step must carry the question asked of the index, got %q", steps[0].Target)
	}
}

func TestTheReadingWindowReachesOnlyRetrievalOfTheServersTools(t *testing.T) {
	with := &Companion{Root: ragProject(t, true).Root}

	named := strings.Split(with.tools(), ",")
	var fromServer []string
	for _, name := range named {
		if strings.HasPrefix(strings.TrimSpace(name), "mcp__"+ragServerName+"__") {
			fromServer = append(fromServer, strings.TrimSpace(name))
		}
	}
	if len(fromServer) != 1 || fromServer[0] != ragToolName {
		t.Fatalf("the window may reach exactly one of the server's tools, got %v — "+
			"'facet mcp' serves write tools, and the permission list is what keeps them out", fromServer)
	}

	// And nothing that writes is named under any spelling, including a tool
	// that arrives later under a prefix nobody thought to check.
	for _, name := range named {
		name = strings.TrimSpace(name)
		if name == ragToolName {
			continue
		}
		for _, verb := range []string{"write", "create", "set", "remove", "rename", "commit", "propose", "delete"} {
			if strings.Contains(strings.ToLower(name), verb) {
				t.Errorf("tool %q is in the reading window's permission list and its name says it writes", name)
			}
		}
	}
}
