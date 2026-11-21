package server_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/facet-framework/atlas/backend/server"
)

// call posts one plugin call and returns the response.
func call(t *testing.T, srv *server.Server, body string, opts ...func(*http.Request)) *http.Response {
	t.Helper()
	req := loopbackRequest(http.MethodPost, server.PluginCallPath, strings.NewReader(body))
	req.Header.Set("Origin", "http://127.0.0.1:7777")
	req.Host = "127.0.0.1:7777"
	for _, o := range opts {
		o(req)
	}
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return rec.Result()
}

func capability(t *testing.T, srv *server.Server, plugin string) func(*http.Request) {
	t.Helper()
	page := loopbackRequest(http.MethodGet, "/", nil)
	page.Host = "127.0.0.1:7777"
	pageRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(pageRec, page)
	res := pageRec.Result()
	cookies := res.Cookies()
	if len(cookies) == 0 {
		t.Fatal("Atlas did not establish a plugin session")
	}

	body := `{"plugins":["` + plugin + `"]}`
	req := loopbackRequest(http.MethodPost, server.PluginSessionPath, strings.NewReader(body))
	req.Host = "127.0.0.1:7777"
	req.Header.Set("Origin", "http://127.0.0.1:7777")
	req.AddCookie(cookies[0])
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("claiming %s capability: %d: %s", plugin, rec.Code, rec.Body.String())
	}
	var answer struct {
		Capabilities map[string]string `json:"capabilities"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&answer); err != nil {
		t.Fatalf("capability response: %v", err)
	}
	token := answer.Capabilities[plugin]
	if token == "" {
		t.Fatalf("no capability for %s", plugin)
	}
	return func(r *http.Request) { r.Header.Set("X-Facet-Plugin-Capability", token) }
}

func decode(t *testing.T, res *http.Response) struct {
	Result json.RawMessage `json:"result"`
	Denied string          `json:"denied"`
	Error  string          `json:"error"`
} {
	t.Helper()
	var out struct {
		Result json.RawMessage `json:"result"`
		Denied string          `json:"denied"`
		Error  string          `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatalf("the response is not JSON: %v", err)
	}
	return out
}

func TestAPluginCallFromAForeignOriginIsRefused(t *testing.T) {
	srv := &server.Server{}

	res := call(t, srv, `{"plugin":"sample","tool":"fixture.pull"}`, func(r *http.Request) {
		r.Header.Set("Origin", "https://example.com")
	})

	// The floor every route in this server keeps: a page on the internet that
	// guessed the port gets nothing.
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("a foreign origin was served: %d", res.StatusCode)
	}
}

// A second Atlas on the next port is a foreign origin too: sameServerOrigin
// compares the whole host, port included. Drop the port from that comparison
// and this goes red while TestAPluginCallFromAForeignOriginIsRefused, whose
// origin differs in scheme and host, stays green.
func TestAPluginCallFromAnotherLocalPortIsRefused(t *testing.T) {
	srv := &server.Server{}

	res := call(t, srv, `{"plugin":"sample","tool":"fixture.pull"}`, func(r *http.Request) {
		r.Header.Set("Origin", "http://127.0.0.1:7778")
	})

	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("a loopback origin on another port was served: %d", res.StatusCode)
	}
}

func TestACrossSitePluginCallWithoutAnOriginIsRefused(t *testing.T) {
	srv := &server.Server{}

	res := call(t, srv, `{"plugin":"sample","tool":"fixture.pull"}`, func(r *http.Request) {
		r.Header.Del("Origin")
		r.Header.Set("Sec-Fetch-Site", "cross-site")
	})

	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("a call without an Origin was served: %d", res.StatusCode)
	}
}

func TestAPluginCallMustBeAPost(t *testing.T) {
	srv := &server.Server{}
	req := loopbackRequest(http.MethodGet, server.PluginCallPath, nil)
	req.Host = "127.0.0.1:7777"
	req.Header.Set("Origin", "http://127.0.0.1:7777")
	rec := httptest.NewRecorder()

	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("a GET was accepted: %d", rec.Code)
	}
}

func TestPluginCapabilitiesRequireAnAtlasDocumentAndCanBeClaimedOnce(t *testing.T) {
	dir := t.TempDir()
	writeUINotifyPlugin(t, dir, "concepts", true)
	srv := &server.Server{PluginsDir: dir}
	claim := func(cookie *http.Cookie) *httptest.ResponseRecorder {
		req := loopbackRequest(http.MethodPost, server.PluginSessionPath, strings.NewReader(`{"plugins":["concepts"]}`))
		req.Host = "127.0.0.1:7777"
		req.Header.Set("Origin", "http://127.0.0.1:7777")
		if cookie != nil {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		return rec
	}

	if rec := claim(nil); rec.Code != http.StatusForbidden {
		t.Fatalf("capabilities without an Atlas document were accepted: %d", rec.Code)
	}
	page := loopbackRequest(http.MethodGet, "/", nil)
	page.Host = "127.0.0.1:7777"
	pageRec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(pageRec, page)
	cookie := pageRec.Result().Cookies()[0]
	if rec := claim(cookie); rec.Code != http.StatusOK {
		t.Fatalf("first capability claim = %d: %s", rec.Code, rec.Body.String())
	}
	if rec := claim(cookie); rec.Code != http.StatusForbidden {
		t.Fatalf("a second capability claim was accepted: %d", rec.Code)
	}
}

func TestWithoutAPluginDirectoryEveryCallIsRefused(t *testing.T) {
	// The honest default: a reader nobody pointed at a directory has no
	// installed plugins. A call must be refused rather than resolved against
	// a guess.

	srv := &server.Server{}

	res := call(t, srv, `{"plugin":"adr","tool":"fixture.pull"}`, capability(t, srv, "adr"))
	got := decode(t, res)

	if res.StatusCode != http.StatusOK {
		t.Fatalf("a refusal was sent as an HTTP error: %d", res.StatusCode)
	}
	if got.Denied != "no plugin directory is configured" {
		t.Fatalf("a call without a plugin directory was not denied for that reason: %+v", got)
	}
	if got.Result != nil {
		t.Errorf("a denied call carried a result: %s", got.Result)
	}
}

func TestARefusalIsAStateAndNotAnHTTPError(t *testing.T) {
	srv := &server.Server{PluginsDir: t.TempDir()}

	res := call(t, srv, `{"plugin":"randnotiz","tool":"fixture.pull"}`)
	got := decode(t, res)

	if res.StatusCode != http.StatusOK {
		t.Fatalf("a refusal arrived as %d, so the reason cannot be shown", res.StatusCode)
	}
	if got.Denied == "" {
		t.Fatalf("an unknown plugin was not denied: %+v", got)
	}
}

func TestACallThatIsNotJSONIsRejected(t *testing.T) {
	srv := &server.Server{PluginsDir: t.TempDir()}

	res := call(t, srv, `not json`)

	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("a malformed body was accepted: %d", res.StatusCode)
	}
}

// writeUINotifyPlugin lays down a plugin that declares and is granted
// server.notify and nothing else — a minimal fixture, because the check this tool
// needs is the ordinary declare-and-grant one every other host tool already
// gets, not anything about the plugin itself.
func writeUINotifyPlugin(t *testing.T, dir, id string, granted bool) {
	t.Helper()
	pdir := filepath.Join(dir, id)
	if err := os.MkdirAll(pdir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	manifest := `{"id":"` + id + `","tools":["server.notify"]}`
	if err := os.WriteFile(filepath.Join(pdir, "plugin.json"), []byte(manifest), 0o644); err != nil {
		t.Fatalf("write plugin.json: %v", err)
	}
	if !granted {
		return
	}
	if err := os.WriteFile(filepath.Join(pdir, "grants.json"), []byte(`{"tools":["server.notify"]}`), 0o644); err != nil {
		t.Fatalf("write grants.json: %v", err)
	}
}

// Named runnable mutation: delete the `"server.notify": hostUINotify` line from
// hostTools in plugincall.go — the call then falls through to broker.Call,
// which finds no sidecar for a plugin with none declared, and this goes red
// with a `failed`/`ErrNoSidecar` shape instead of an ok result.
func TestUINotifyAnsweredAsAHostToolOnceDeclaredAndGranted(t *testing.T) {
	dir := t.TempDir()
	writeUINotifyPlugin(t, dir, "concepts", true)
	srv := &server.Server{PluginsDir: dir}

	res := call(t, srv, `{"plugin":"concepts","tool":"server.notify","args":{"place":"header.action","on":true}}`, capability(t, srv, "concepts"))
	got := decode(t, res)

	if got.Denied != "" || got.Error != "" {
		t.Fatalf("a declared and granted call was refused: denied=%q error=%q", got.Denied, got.Error)
	}
	if got.Result == nil {
		t.Fatalf("a granted call carried no result: %+v", got)
	}
}

func TestUINotifyRefusedWhenDeclaredButNotGranted(t *testing.T) {
	dir := t.TempDir()
	writeUINotifyPlugin(t, dir, "concepts", false)
	srv := &server.Server{PluginsDir: dir}

	res := call(t, srv, `{"plugin":"concepts","tool":"server.notify","args":{"place":"header.action","on":true}}`, capability(t, srv, "concepts"))
	got := decode(t, res)

	if got.Denied == "" {
		t.Fatalf("a declared but ungranted server.notify was not refused: %+v", got)
	}
	if got.Result != nil {
		t.Errorf("a refused call carried a result: %s", got.Result)
	}
}

// Named runnable mutation: in pluginCall's hostTools branch, change
// `if err := broker.Allowed(...); err != nil` to `false && err != nil` — the
// declare-and-grant gate is skipped for every host tool, and this fixture's
// undeclared server.notify would otherwise be refused only by luck.
func TestUINotifyRefusedWhenTheManifestNeverDeclaredIt(t *testing.T) {
	dir := t.TempDir()
	pdir := filepath.Join(dir, "concepts")
	if err := os.MkdirAll(pdir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pdir, "plugin.json"), []byte(`{"id":"concepts","tools":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	srv := &server.Server{PluginsDir: dir}

	res := call(t, srv, `{"plugin":"concepts","tool":"server.notify","args":{"place":"header.action","on":true}}`, capability(t, srv, "concepts"))
	got := decode(t, res)

	if got.Denied == "" {
		t.Fatalf("an undeclared server.notify was not refused: %+v", got)
	}
}

// Mutation: drop the `a.Place == ""` check in hostUINotify — a call missing
// its place would then answer ok instead of failing, and this goes red.
func TestUINotifyFailsWithoutAPlace(t *testing.T) {
	dir := t.TempDir()
	writeUINotifyPlugin(t, dir, "concepts", true)
	srv := &server.Server{PluginsDir: dir}

	res := call(t, srv, `{"plugin":"concepts","tool":"server.notify","args":{"on":true}}`, capability(t, srv, "concepts"))
	got := decode(t, res)

	if got.Error == "" {
		t.Fatalf("a call without a place was not answered as a failure: %+v", got)
	}
}
