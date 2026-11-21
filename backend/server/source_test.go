package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/facet-framework/core/registry"
)

// sourceTestTag is the anchor marker, split so this file does not carry an
// anchor itself.
const sourceTestTag = "@fa" + "cet"

const sourceAnchorLine = "// " + sourceTestTag + ": payments/checkout/charge\n"

// sourceRepo lays out a repository with one anchored file and, around it,
// everything the endpoint must refuse: a .env, a .git directory with an
// anchored-looking config, an ignored transcript that mentions the tag, a link
// inside the repository to .git, and a link to a file outside it.
func sourceRepo(t *testing.T) (root string, outside string) {
	t.Helper()
	base := t.TempDir()
	root = filepath.Join(base, "repo")
	write := func(rel, body string) {
		t.Helper()
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("src/pay/charge.go", "package pay\n\n"+sourceAnchorLine+"// "+sourceTestTag+"-role: primary\nfunc Charge() {}\n")
	write(".env", "TOKEN=secret-in-repo\n")
	write(".git/config", sourceAnchorLine+"token = secret-in-git\n")
	write(".gitignore", "ignored/\n")
	write("ignored/session.go", sourceAnchorLine+"TOKEN=secret-in-transcript\n")
	outside = filepath.Join(base, "secret.go")
	if err := os.WriteFile(outside, []byte(sourceAnchorLine+"TOKEN=outside\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "src", "link.go")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join("..", ".git", "config"), filepath.Join(root, "src", "cfg.go")); err != nil {
		t.Fatal(err)
	}
	return root, outside
}

// sourceRequest is what the reader's own page sends: a same-origin fetch with
// no Origin header, to a loopback host.
func sourceRequest(method, rel string) *http.Request {
	req := loopbackRequest(method, SourcePath+"?path="+url.QueryEscape(rel), nil)
	req.Host = "127.0.0.1:7483"
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	return req
}

func serveSource(s *Server, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func decodeSource(t *testing.T, rec *httptest.ResponseRecorder) sourceResponse {
	t.Helper()
	var body sourceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unreadable response %q: %v", rec.Body.String(), err)
	}
	return body
}

var sourceSecrets = []string{"secret-in-repo", "secret-in-git", "secret-in-transcript", "TOKEN=outside"}

func TestSourceAnswersAnAnchoredFileWithTheAnchorLinesTheHostScanned(t *testing.T) {
	root, _ := sourceRepo(t)
	s := &Server{Registry: facet.Registry{Root: root}}
	rec := serveSource(s, sourceRequest(http.MethodGet, "src/pay/charge.go"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	for header, want := range map[string]string{
		"Content-Type":           "application/json",
		"X-Content-Type-Options": "nosniff",
		"Cache-Control":          "no-store",
	} {
		if got := rec.Header().Get(header); got != want {
			t.Errorf("%s = %q, want %q", header, got, want)
		}
	}
	got := decodeSource(t, rec)
	if got.State != sourceOK || !strings.Contains(got.Text, "func Charge()") {
		t.Fatalf("state %q text %q", got.State, got.Text)
	}
	if len(got.Anchors) != 1 || got.Anchors[0].Line != 3 || got.Anchors[0].ID != "payments/checkout/charge" || got.Anchors[0].Role != "primary" {
		t.Fatalf("anchors = %+v, want one at line 3", got.Anchors)
	}
}

func TestSourceRefusesEveryFileThatIsNotAnAnchoredFileInsideTheRepository(t *testing.T) {
	root, outside := sourceRepo(t)
	// Precondition: everything refused below is really there, and the ignored
	// transcript and .git config really carry the tag, so a refusal is the
	// guard's doing and not an empty fixture.
	for _, p := range []string{".env", ".git/config", "ignored/session.go", "src/link.go", "src/cfg.go"} {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(p))); err != nil {
			t.Fatalf("fixture missing %s: %v", p, err)
		}
	}
	for _, p := range []string{filepath.Join(root, "ignored", "session.go"), filepath.Join(root, ".git", "config")} {
		data, _ := os.ReadFile(p)
		if len(facet.ScanContent(p, data)) == 0 {
			t.Fatalf("fixture %s carries no anchor", p)
		}
	}
	s := &Server{Registry: facet.Registry{Root: root}}
	cases := map[string]string{
		".env":                           sourceNotAnchored,
		"ignored/session.go":             sourceNotAnchored,
		".git/config":                    sourceInvalid,
		".GIT/config":                    sourceInvalid,
		".Git/config":                    sourceInvalid,
		".git./config":                   sourceInvalid,
		".git::$INDEX_ALLOCATION/config": sourceInvalid,
		`src\pay\charge.go`:              sourceInvalid,
		"C:/repo/src/pay/charge.go":      sourceInvalid,
		"../secret.go":                   sourceInvalid,
		outside:                          sourceInvalid,
		"src/link.go":                    sourceOutside,
		"src/cfg.go":                     sourceOutside,
		"src/none.go":                    sourceMissing,
		"src":                            sourceMissing,
		"":                               sourceInvalid,
		"src/../src/pay/charge.go":       sourceInvalid,
		"./src/pay/charge.go":            sourceInvalid,
	}
	for rel, want := range cases {
		rec := serveSource(s, sourceRequest(http.MethodGet, rel))
		if rec.Code != http.StatusOK {
			t.Errorf("%q: status %d", rel, rec.Code)
			continue
		}
		if got := decodeSource(t, rec); got.State != want {
			t.Errorf("%q: state %q, want %q", rel, got.State, want)
		}
		body := rec.Body.String()
		for _, leak := range append([]string{root}, sourceSecrets...) {
			if strings.Contains(body, leak) {
				t.Errorf("%q: the answer leaks %q: %s", rel, leak, body)
			}
		}
	}
}

func TestSourceRefusesCallersThatAreNotTheReader(t *testing.T) {
	root, _ := sourceRepo(t)
	s := &Server{Registry: facet.Registry{Root: root}}
	foreignHost := sourceRequest(http.MethodGet, "src/pay/charge.go")
	foreignHost.Host = "evil.example:7483"
	crossSite := sourceRequest(http.MethodGet, "src/pay/charge.go")
	crossSite.Header.Set("Sec-Fetch-Site", "cross-site")
	noHeaders := sourceRequest(http.MethodGet, "src/pay/charge.go")
	noHeaders.Header.Del("Sec-Fetch-Site")
	foreignOrigin := sourceRequest(http.MethodGet, "src/pay/charge.go")
	foreignOrigin.Header.Set("Origin", "https://evil.example")
	post := sourceRequest(http.MethodPost, "src/pay/charge.go")
	cases := map[string]struct {
		req  *http.Request
		want int
	}{
		"foreign host":             {foreignHost, http.StatusForbidden},
		"cross-site fetch":         {crossSite, http.StatusForbidden},
		"no origin, no fetch site": {noHeaders, http.StatusForbidden},
		"foreign origin":           {foreignOrigin, http.StatusForbidden},
		"POST":                     {post, http.StatusMethodNotAllowed},
	}
	for name, c := range cases {
		rec := serveSource(s, c.req)
		if rec.Code != c.want {
			t.Errorf("%s: status %d, want %d", name, rec.Code, c.want)
		}
		if strings.Contains(rec.Body.String(), "func Charge") {
			t.Errorf("%s: the file was answered: %s", name, rec.Body.String())
		}
		if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s: nosniff missing", name)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control = %q, want no-store", name, got)
		}
	}
	// The reader itself still gets through, from every loopback spelling.
	for _, host := range []string{"localhost:7483", "127.0.0.1", "[::1]:7483"} {
		req := sourceRequest(http.MethodGet, "src/pay/charge.go")
		req.Host = host
		if rec := serveSource(s, req); rec.Code != http.StatusOK || decodeSource(t, rec).State != sourceOK {
			t.Errorf("host %s: status %d %s", host, rec.Code, rec.Body.String())
		}
	}
	local := sourceRequest(http.MethodGet, "src/pay/charge.go")
	local.Header.Del("Sec-Fetch-Site")
	local.Header.Set("Origin", "http://127.0.0.1:7483")
	if rec := serveSource(s, local); rec.Code != http.StatusOK {
		t.Errorf("local origin: status %d", rec.Code)
	}
}

func TestSourceRefusesAFileAboveTheLimit(t *testing.T) {
	root, _ := sourceRepo(t)
	big := sourceAnchorLine + strings.Repeat("x", maxSourceBytes)
	if err := os.WriteFile(filepath.Join(root, "src", "big.go"), []byte(big), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &Server{Registry: facet.Registry{Root: root}}
	got := decodeSource(t, serveSource(s, sourceRequest(http.MethodGet, "src/big.go")))
	if got.State != sourceTooLarge || got.Text != "" {
		t.Fatalf("state %q, text length %d", got.State, len(got.Text))
	}
}
