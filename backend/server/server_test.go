// Like corpus_test.go, the fixtures here anchor features that exist only in a
// temporary directory: @facet-ignore-file
package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

func testServer(t *testing.T) *httptest.Server {
	t.Helper()
	reg := project(t, map[string]string{
		"docs/facets/features/tasks/create/quick-add.yaml": quickAdd,
		"src/quick_add.ts": "// @facet: tasks/create/quick-add\nexport function quickAdd() {}\n",
	})
	assets := fstest.MapFS{
		"index.html": {Data: []byte("<div id=\"atlas\"></div>")},
		"atlas.js":   {Data: []byte("export default 1;")},
	}
	srv := httptest.NewServer((&Server{Registry: reg, Assets: assets}).Handler())
	t.Cleanup(srv.Close)
	return srv
}

func readerGET(target string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	return http.DefaultClient.Do(req)
}

// events splits an event stream into (name, payload) pairs.
func events(t *testing.T, body string) [][2]string {
	t.Helper()
	var out [][2]string
	for _, block := range strings.Split(body, "\n\n") {
		var name, data string
		for _, line := range strings.Split(block, "\n") {
			switch {
			case strings.HasPrefix(line, "event: "):
				name = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				data = strings.TrimPrefix(line, "data: ")
			}
		}
		if name != "" {
			out = append(out, [2]string{name, data})
		}
	}
	return out
}

func TestStreamEndsWithTheWholeCorpus(t *testing.T) {
	srv := testServer(t)

	res, err := readerGET(srv.URL + StreamPath)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	if got := res.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Errorf("want an event stream, got %q", got)
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}

	all := events(t, string(body))
	if len(all) < 2 {
		t.Fatalf("want progress and a result, got %d events", len(all))
	}
	if first := all[0][0]; first != "status" {
		t.Errorf("the stream should open with progress, got %q", first)
	}

	last := all[len(all)-1]
	if last[0] != "ready" {
		t.Fatalf("want the run to end with 'ready', got %q", last[0])
	}
	var corpus Corpus
	if err := json.Unmarshal([]byte(last[1]), &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Records) != 1 {
		t.Errorf("want the one record, got %d", len(corpus.Records))
	}
	if len(corpus.Scan.Anchors) != 1 {
		t.Errorf("want the one anchor group, got %d", len(corpus.Scan.Anchors))
	}
}

func TestStreamReportsAFailureAsAnEventRatherThanACutConnection(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	srv := httptest.NewServer((&Server{Registry: reg, Assets: fstest.MapFS{}}).Handler())
	defer srv.Close()

	res, err := readerGET(srv.URL + StreamPath)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	all := events(t, string(body))
	last := all[len(all)-1]
	if last[0] != "failed" {
		t.Fatalf("want a 'failed' event, got %q", last[0])
	}
	if !strings.Contains(last[1], "docs/facets") {
		t.Errorf("the failure should say what was missing, got %s", last[1])
	}
}

func TestStreamRefusesAnOriginThatIsNotLocal(t *testing.T) {
	srv := testServer(t)

	req, _ := http.NewRequest(http.MethodGet, srv.URL+StreamPath, nil)
	req.Header.Set("Origin", "https://evil.example")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusForbidden {
		t.Errorf("want 403 for a foreign origin, got %d", res.StatusCode)
	}
}

func TestStreamRefusesAnotherLocalhostPort(t *testing.T) {
	srv := testServer(t)

	req, _ := http.NewRequest(http.MethodGet, srv.URL+StreamPath, nil)
	req.Header.Set("Origin", "http://localhost:3000")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("want 403, got %d", res.StatusCode)
	}
}

func TestStreamAllowsOnlyItsOwnOrigin(t *testing.T) {
	srv := testServer(t)
	req, _ := http.NewRequest(http.MethodGet, srv.URL+StreamPath, nil)
	req.Header.Set("Origin", srv.URL)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", res.StatusCode)
	}
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("same-origin response reflected a CORS origin: %q", got)
	}
}

func TestReaderIsServedFromTheEmbeddedBundle(t *testing.T) {
	srv := testServer(t)

	for _, path := range []string{"/", "/atlas.js"} {
		res, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("GET %s = %d", path, res.StatusCode)
		}
		if len(body) == 0 {
			t.Errorf("GET %s returned nothing", path)
		}
	}
}

func TestUnknownPathsFallBackToTheEntryPage(t *testing.T) {
	srv := testServer(t)

	res, err := http.Get(srv.URL + "/records/tasks/create/quick-add")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)

	if res.StatusCode != http.StatusOK || !strings.Contains(string(body), "id=\"atlas\"") {
		t.Errorf("a reload of a deep link should land on the reader, got %d %s", res.StatusCode, body)
	}
}

// The bundle a plain run serves is the one go:embed took from the generated
// directory: every file of the built reader comes over HTTP byte for byte as
// it lies in internal/ui/assets. TestReaderIsServedFromTheEmbeddedBundle
// serves a hand-made bundle and cannot say this.
func TestThePlainServerServesTheBuiltBundleFromTheGeneratedDirectory(t *testing.T) {
	requireBuiltReader(t)
	reg := project(t, map[string]string{
		"docs/facets/features/tasks/create/quick-add.yaml": quickAdd,
	})
	// No Assets supplied: the server falls back to the embedded bundle.
	srv := httptest.NewServer((&Server{Registry: reg}).Handler())
	defer srv.Close()

	for path, file := range map[string]string{
		"/":          "index.html",
		"/atlas.js":  "atlas.js",
		"/atlas.css": "atlas.css",
	} {
		onDisk, err := os.ReadFile("assets/" + file)
		if err != nil {
			t.Fatalf("the generated directory holds no %s: %v", file, err)
		}
		if len(onDisk) == 0 {
			t.Fatalf("the generated %s is empty, so a match would prove nothing", file)
		}
		res, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		served, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("GET %s = %d", path, res.StatusCode)
		}
		if string(served) != string(onDisk) {
			t.Errorf("GET %s served %d bytes that differ from the built %s (%d bytes)", path, len(served), file, len(onDisk))
		}
	}
	// The entry page is the reader, not the placeholder that names the build.
	if page := get(t, srv, "/"); strings.Contains(string(page), "sync-server.sh --build") {
		t.Error("the plain server serves the placeholder although the reader is built")
	}
}

func TestTheBundledReaderIsActuallyEmbedded(t *testing.T) {
	requireBuiltReader(t)
	assets := Assets()

	for _, name := range []string{"index.html", "atlas.js", "atlas.css"} {
		file, err := assets.Open(name)
		if err != nil {
			t.Fatalf("the binary ships without %s — build the reader assets before compiling: %v", name, err)
		}
		file.Close()
	}
}

func TestListenBindsToLoopback(t *testing.T) {
	ln, err := Listen(0)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	if !strings.HasPrefix(ln.Addr().String(), "127.0.0.1:") {
		t.Errorf("the corpus must not be offered to the network, got %s", ln.Addr())
	}
}

func TestListenFallsBackWhenThePortIsTaken(t *testing.T) {
	first, err := Listen(0)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	taken := first.Addr().(interface{ String() string }).String()
	port := 0
	if i := strings.LastIndex(taken, ":"); i >= 0 {
		for _, c := range taken[i+1:] {
			port = port*10 + int(c-'0')
		}
	}

	second, err := Listen(port)
	if err != nil {
		t.Fatalf("a taken port should not stop the server: %v", err)
	}
	defer second.Close()

	if second.Addr().String() == taken {
		t.Error("the fallback listener took the same address twice")
	}
}

// The companion's steps reach the browser as they happen, each under its own
// event name, so the reader can render a read differently from an answer
// without unpacking every payload first.
func TestCompanionStreamsItsStepsAsEvents(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	bin := fakeClaude(t,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"quickAdd"}}]}}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Found it."}}}`,
		`{"type":"result","subtype":"success","session_id":"s1","total_cost_usd":0.01}`,
	)
	srv := httptest.NewServer((&Server{
		Registry:  reg,
		Assets:    fstest.MapFS{},
		Companion: &Companion{Root: reg.Root, Bin: bin},
	}).Handler())
	defer srv.Close()

	res, err := companionGET(srv.URL + CompanionPath + "?q=where+is+quickAdd")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}

	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, event := range events(t, string(body)) {
		names = append(names, event[0])
	}
	want := []string{"read", "text", "done"}
	if len(names) != len(want) {
		t.Fatalf("events = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Errorf("event %d = %q, want %q", i, names[i], want[i])
		}
	}
}

// A question is required, and its absence is a bad request rather than an empty
// stream that leaves the reader waiting for an answer that will never come.
func TestCompanionWithoutAQuestionIsRejected(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	srv := httptest.NewServer((&Server{Registry: reg, Assets: fstest.MapFS{}}).Handler())
	defer srv.Close()

	res, err := companionGET(srv.URL + CompanionPath)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", res.StatusCode)
	}
}

// The corpus is guarded against a page on the internet that guessed the port;
// the companion has to be guarded for the same reason and one more: it reads
// files on request.
func TestCompanionRefusesAForeignOrigin(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	srv := httptest.NewServer((&Server{Registry: reg, Assets: fstest.MapFS{}}).Handler())
	defer srv.Close()

	req, err := http.NewRequest(http.MethodGet, srv.URL+CompanionPath+"?q=hello", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", "https://example.com")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", res.StatusCode)
	}
}

func TestCompanionRefusesARequestWithoutAnOrigin(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	srv := httptest.NewServer((&Server{Registry: reg, Assets: fstest.MapFS{}}).Handler())
	defer srv.Close()

	res, err := http.Get(srv.URL + CompanionPath + "?q=hello")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", res.StatusCode)
	}
}

// The reader's own page asks over a same-origin EventSource, which carries no
// Origin header. The browser marks it Sec-Fetch-Site: same-origin, and that
// request must reach the handler. An empty question proves it got past the
// guard without starting an agent: the guard answers 403, the handler 400.
func TestCompanionAcceptsTheReadersOwnPageWithoutAnOrigin(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	srv := httptest.NewServer((&Server{Registry: reg, Assets: fstest.MapFS{}}).Handler())
	defer srv.Close()

	for _, tc := range []struct {
		site string
		want int
	}{
		{"same-origin", http.StatusBadRequest},
		{"cross-site", http.StatusForbidden},
		{"same-site", http.StatusForbidden},
		{"none", http.StatusForbidden},
	} {
		req, err := http.NewRequest(http.MethodGet, srv.URL+CompanionPath+"?q=", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Sec-Fetch-Site", tc.site)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Errorf("Sec-Fetch-Site %q: status = %d, want %d", tc.site, res.StatusCode, tc.want)
		}
		if res.Header.Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("Sec-Fetch-Site %q: a request without Origin got an Access-Control-Allow-Origin", tc.site)
		}
	}
}

// Sec-Fetch-Site does not override a foreign Origin.
func TestCompanionRefusesAForeignOriginEvenWhenMarkedSameOrigin(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	srv := httptest.NewServer((&Server{Registry: reg, Assets: fstest.MapFS{}}).Handler())
	defer srv.Close()

	req, err := http.NewRequest(http.MethodGet, srv.URL+CompanionPath+"?q=", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", "https://example.com")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", res.StatusCode)
	}
}

func companionGET(target string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Origin", req.URL.Scheme+"://"+req.URL.Host)
	return http.DefaultClient.Do(req)
}

func TestNoQueryParameterCanWidenTheToolList(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	bin, argv := recordingClaude(t)
	srv := httptest.NewServer((&Server{
		Registry:  reg,
		Assets:    fstest.MapFS{},
		Companion: &Companion{Root: reg.Root, Bin: bin},
	}).Handler())
	defer srv.Close()

	// Every spelling a wired-up switch would plausibly have used.
	query := "?q=what+is+here&readOnly=false&read_only=false&tools=Bash,Write&allowedTools=Bash" +
		"&disallowedTools=&write=1&unsafe=1"
	res, err := companionGET(srv.URL + CompanionPath + query)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if _, err := io.ReadAll(res.Body); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(argv)
	if err != nil {
		t.Fatalf("the agent was never spawned: %v", err)
	}
	args := strings.Split(strings.TrimSuffix(string(data), "\x00"), "\x00")

	if got := valueAfter(args, "--tools"); got != readOnlyTools {
		t.Errorf("--tools = %q, want %q: a query parameter reached the tool list", got, readOnlyTools)
	}
	if got := valueAfter(args, "--disallowedTools"); got != blockedTools {
		t.Errorf("--disallowedTools = %q, want %q: a query parameter emptied the deny list", got, blockedTools)
	}
	// And nothing from the query arrived as a flag of its own.
	for _, arg := range args {
		for _, forbidden := range []string{"Bash", "Write", "--allowedTools", "--dangerously"} {
			if strings.Contains(arg, forbidden) && arg != blockedTools {
				t.Errorf("argument %q carries %q from the query string", arg, forbidden)
			}
		}
	}
}

func TestNoQueryParameterCanLoadTheRepositorysConfiguration(t *testing.T) {
	reg := project(t, map[string]string{"src/main.go": "package main\n"})
	bin, argv := recordingClaude(t)
	srv := httptest.NewServer((&Server{
		Registry:  reg,
		Assets:    fstest.MapFS{},
		Companion: &Companion{Root: reg.Root, Bin: bin},
	}).Handler())
	defer srv.Close()

	// Every spelling a wired-up hooks switch would plausibly have used.
	query := "?q=what+is+here&hooks=1&hooks=true&settingSources=project&setting_sources=project" +
		"&settings=user,project&plugins=1&claudeMd=1&safeMode=0&bare=0"
	res, err := companionGET(srv.URL + CompanionPath + query)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if _, err := io.ReadAll(res.Body); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(argv)
	if err != nil {
		t.Fatalf("the agent was never spawned: %v", err)
	}
	args := strings.Split(strings.TrimSuffix(string(data), "\x00"), "\x00")

	// Every occurrence, not the first: Claude Code takes the last it is given,
	// so a second flag appended from the query would be the one that counts.
	var sources int
	for i, arg := range args {
		if arg != "--setting-sources" {
			continue
		}
		sources++
		if i+1 < len(args) && args[i+1] != "" {
			t.Errorf("--setting-sources = %q, want empty: a query parameter reached the isolation", args[i+1])
		}
	}
	if sources != 1 {
		t.Errorf("--setting-sources appears %d times in %v, want exactly once", sources, args)
	}
	if !contains(args, "--strict-mcp-config") {
		t.Error("a query parameter removed --strict-mcp-config")
	}
	if contains(args, "--bare") {
		t.Error("--bare arrived from the query and would take the sign-in with it")
	}
	// And nothing from the query arrived as a flag of its own.

	for _, arg := range args {
		for _, forbidden := range []string{"--settings", "--plugin", "--add-dir"} {
			if strings.HasPrefix(arg, forbidden) {
				t.Errorf("argument %q carries %q from the query string", arg, forbidden)
			}
		}
		if arg == "project" || arg == "user" || arg == "local" {
			t.Errorf("a setting-sources value %q arrived from the query string", arg)
		}
	}
}

func TestListenBindsToLoopbackOnARequestedPort(t *testing.T) {
	borrowed, err := Listen(0)
	if err != nil {
		t.Fatal(err)
	}
	addr := borrowed.Addr().String()
	borrowed.Close()

	port := 0
	if i := strings.LastIndex(addr, ":"); i >= 0 {
		for _, c := range addr[i+1:] {
			port = port*10 + int(c-'0')
		}
	}
	// The fixture asserts its own premise: with port 0 this would measure the
	// branch the other case already covers.
	if port == 0 {
		t.Fatalf("could not borrow a port from %s, so this case would measure Listen(0)", addr)
	}

	ln, err := Listen(port)
	if err != nil {
		// The borrowed port was taken again between Close and Listen. Rare,
		// and not a finding about the binding — say so rather than fail.
		t.Skipf("the borrowed port %d was taken again: %v", port, err)
	}
	defer ln.Close()

	if !strings.HasPrefix(ln.Addr().String(), "127.0.0.1:") {
		t.Errorf("a requested port must not be offered to the network, got %s", ln.Addr())
	}
}

func TestARequestWithoutAnOriginRequiresSameOriginFetchMetadata(t *testing.T) {
	srv := testServer(t)

	// The fixture's precondition: this server does refuse a foreign origin on
	// the same route, so the 200 below is the origin rule and not a route that
	// answers everyone.
	foreign, _ := http.NewRequest(http.MethodGet, srv.URL+StreamPath, nil)
	foreign.Header.Set("Origin", "https://example.invalid")
	refused, err := http.DefaultClient.Do(foreign)
	if err != nil {
		t.Fatal(err)
	}
	refused.Body.Close()
	if refused.StatusCode != http.StatusForbidden {
		t.Fatalf("the server under test does not refuse a foreign origin (%d), so this case measures nothing", refused.StatusCode)
	}

	req, _ := http.NewRequest(http.MethodGet, srv.URL+StreamPath, nil)
	if _, set := req.Header["Origin"]; set {
		t.Fatal("the request under test carries an Origin header")
	}
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("a cross-site request without an Origin got %d, want 403", res.StatusCode)
	}

	res, err = readerGET(srv.URL + StreamPath)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("a same-origin request without an Origin got %d, want 200", res.StatusCode)
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	all := events(t, string(body))
	if len(all) == 0 || all[len(all)-1][0] != "ready" {
		t.Fatalf("a request without an Origin was not served the corpus: %s", body)
	}
	var corpus Corpus
	if err := json.Unmarshal([]byte(all[len(all)-1][1]), &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Records) != 1 {
		t.Errorf("want the fixture's one record, got %d", len(corpus.Records))
	}
}

// Reload opens a fresh corpus stream; the handler must read the working tree
// again rather than retaining the previous request's parsed registry.
func TestReloadRereadsChangedRepository(t *testing.T) {
	const rel = "docs/facets/features/tasks/create/quick-add.yaml"
	reg := project(t, map[string]string{rel: quickAdd})
	srv := httptest.NewServer((&Server{Registry: reg, Assets: fstest.MapFS{"index.html": {Data: []byte("atlas")}}}).Handler())
	defer srv.Close()
	read := func() string {
		t.Helper()
		response, err := readerGET(srv.URL + StreamPath)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatal(err)
		}
		for _, event := range events(t, string(data)) {
			if event[0] == "ready" {
				return event[1]
			}
		}
		t.Fatalf("no ready event: %s", data)
		return ""
	}
	before := read()
	const marker = "atlas-reload-working-tree-proof"
	if strings.Contains(before, marker) {
		t.Fatal("marker already present before edit")
	}
	if err := os.WriteFile(reg.Root+"/"+rel, []byte(quickAdd+"\nmetadata:\n  reload_proof: "+marker+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	after := read()
	if !strings.Contains(after, marker) {
		t.Fatalf("second stream reused stale corpus: %s", after)
	}
}

func TestMissingSubresourceDoesNotReplacePluginSession(t *testing.T) {
	prepared := 0
	h := &spaHandler{files: http.FS(fstest.MapFS{"index.html": {Data: []byte("reader")}}), prepareDocument: func(http.ResponseWriter, *http.Request) { prepared++ }}
	for _, dest := range []string{"image", "script", "style"} {
		request := httptest.NewRequest("GET", "http://localhost/favicon.ico", nil)
		request.Header.Set("Sec-Fetch-Dest", dest)
		answer := httptest.NewRecorder()
		h.ServeHTTP(answer, request)
		if answer.Code != http.StatusNotFound || prepared != 0 {
			t.Fatalf("%s: status %d, sessions %d", dest, answer.Code, prepared)
		}
	}
	request := httptest.NewRequest("GET", "http://localhost/p/dmn/pricing.dmn", nil)
	request.Header.Set("Sec-Fetch-Dest", "document")
	answer := httptest.NewRecorder()
	h.ServeHTTP(answer, request)
	if answer.Code != http.StatusOK || prepared != 1 {
		t.Fatalf("document: status %d, sessions %d", answer.Code, prepared)
	}
}
