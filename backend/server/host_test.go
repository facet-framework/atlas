// The anchors in this file belong to a fixture project written into a
// temporary directory: @facet-ignore-file
package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

const hostRefusal = "only a local host name may reach this reader"

// hostGuardServer is the real handler over a real socket, with nothing in it
// that would start an agent: the companion points at a binary that is not
// there.
func hostGuardServer(t *testing.T) *httptest.Server {
	t.Helper()
	reg := project(t, map[string]string{
		"docs/facets/features/tasks/create/quick-add.yaml": quickAdd,
		"src/quick_add.ts": "// @facet: tasks/create/quick-add\nexport function quickAdd() {}\n",
	})
	assets := fstest.MapFS{
		"index.html": {Data: []byte("<div id=\"atlas\"></div>")},
		"atlas.js":   {Data: []byte("export default 1;")},
	}
	s := &Server{
		Registry:  reg,
		Assets:    assets,
		Companion: &Companion{Root: reg.Root, Bin: filepath.Join(t.TempDir(), "no-agent-here")},
	}
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return srv
}

// hostGuardRoutes is one request per route class the server registers: every
// /api/ route, the plugin files, and the entry page.
var hostGuardRoutes = []struct{ method, path string }{
	{http.MethodGet, StreamPath},
	{http.MethodGet, CompanionPath + "?q=hello"},
	{http.MethodGet, CompanionStatePath},
	{http.MethodGet, RepoStatePath},
	{http.MethodGet, RAGPath + "?q=quick"},
	{http.MethodGet, MCPToolsPath},
	{http.MethodGet, TestReportPath},
	{http.MethodGet, SourcePath + "?path=src/quick_add.ts"},
	{http.MethodPost, PluginCallPath},
	{http.MethodGet, "/api/settings/directory"},
	{http.MethodGet, PluginSessionPath},
	{http.MethodGet, InstalledPluginsPath},
	{http.MethodGet, PluginFilesPrefix + "acme/entry.js"},
	{http.MethodGet, "/"},
	{http.MethodGet, "/atlas.js"},
}

func hostGuardDo(t *testing.T, srv *httptest.Server, method, path, host string, header http.Header) (*http.Response, string) {
	t.Helper()
	var body io.Reader
	if method == http.MethodPost {
		body = strings.NewReader(`{}`)
	}
	req, err := http.NewRequest(method, srv.URL+path, body)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range header {
		req.Header[k] = v
	}
	if req.Header.Get("Origin") == "" && req.Header.Get("Sec-Fetch-Site") == "" {
		req.Header.Set("Sec-Fetch-Site", "same-origin")
	}
	if host != "" {
		req.Host = host
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res, string(raw)
}

// A rebound name reaches the loopback port with its own Host. Every route
// refuses it before the route runs — including the ones whose own checks
// (Origin, Sec-Fetch-Site) the browser would satisfy for a rebound page,
// because to the browser that page is same-origin.
func TestAForeignHostIsRefusedOnEveryRoute(t *testing.T) {
	srv := hostGuardServer(t)
	// What a rebound page's same-origin request looks like: its own name as
	// Origin and Host, and same-origin as the fetch site.
	rebound := http.Header{
		"Origin":         {"http://evil.example:80"},
		"Sec-Fetch-Site": {"same-origin"},
	}
	for _, host := range []string{"evil.example", "evil.example:7513", "127.0.0.1.evil.example", "localhost.evil.example:7513"} {
		for _, route := range hostGuardRoutes {
			res, body := hostGuardDo(t, srv, route.method, route.path, host, rebound)
			if res.StatusCode != http.StatusForbidden || !strings.Contains(body, hostRefusal) {
				t.Errorf("%s %s with Host %s: status %d, body %q; want the host refusal", route.method, route.path, host, res.StatusCode, body)
			}
			if strings.Contains(body, "quick-add") || strings.Contains(body, "atlas") {
				t.Errorf("%s %s with Host %s: the route answered: %q", route.method, route.path, host, body)
			}
			if len(res.Cookies()) != 0 {
				t.Errorf("%s %s with Host %s: a cookie was set: %v", route.method, route.path, host, res.Cookies())
			}
			if got := res.Header.Get("X-Content-Type-Options"); got != "nosniff" {
				t.Errorf("%s %s with Host %s: nosniff missing", route.method, route.path, host)
			}
		}
	}
}

// Every loopback spelling gets past the guard and reaches the route itself:
// whatever the route answers, it is not the host refusal.
func TestALoopbackHostReachesEveryRoute(t *testing.T) {
	srv := hostGuardServer(t)
	_, port, _ := strings.Cut(srv.Listener.Addr().String(), ":")
	// "" keeps the address the client dialled, 127.0.0.1:<port>.
	for _, host := range []string{"", "localhost:" + port, "127.0.0.1", "[::1]:" + port} {
		for _, route := range hostGuardRoutes {
			res, body := hostGuardDo(t, srv, route.method, route.path, host, nil)
			if strings.Contains(body, hostRefusal) {
				t.Errorf("%s %s with Host %q: refused by the host guard (status %d)", route.method, route.path, host, res.StatusCode)
			}
		}
	}
}

// The reader's own page still loads through the guard: the entry document
// and a module it names, from the address the command prints.
func TestTheReaderStillLoadsBehindTheHostGuard(t *testing.T) {
	srv := hostGuardServer(t)
	res, body := hostGuardDo(t, srv, http.MethodGet, "/", "", nil)
	if res.StatusCode != http.StatusOK || !strings.Contains(body, `<div id="atlas"></div>`) {
		t.Fatalf("entry page: status %d, body %q", res.StatusCode, body)
	}
	if res.Header.Get("Content-Security-Policy") == "" {
		t.Errorf("entry page served without its policy")
	}
	res, body = hostGuardDo(t, srv, http.MethodGet, "/atlas.js", "", nil)
	if res.StatusCode != http.StatusOK || body != "export default 1;" {
		t.Fatalf("module: status %d, body %q", res.StatusCode, body)
	}
	// A deep link reloads into the same page.
	res, body = hostGuardDo(t, srv, http.MethodGet, "/records", "", nil)
	if res.StatusCode != http.StatusOK || !strings.Contains(body, `<div id="atlas"></div>`) {
		t.Fatalf("deep link: status %d, body %q", res.StatusCode, body)
	}
	// And the corpus stream behind it answers the page.
	res, body = hostGuardDo(t, srv, http.MethodGet, StreamPath, "", nil)
	if res.StatusCode != http.StatusOK || !strings.Contains(body, "tasks/create/quick-add") {
		t.Fatalf("corpus stream: status %d, body %q", res.StatusCode, body)
	}
}
