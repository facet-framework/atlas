package server

import (
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// requireBuiltReader marks a test that grades the real Atlas bundle.
func requireBuiltReader(t *testing.T) {
	t.Helper()
	if ReaderBuilt() {
		return
	}
	if os.Getenv("FACET_REQUIRE_UI") != "" {
		t.Fatal("FACET_REQUIRE_UI is set but backend/server/assets holds no built reader; run 'sh scripts/build.sh'")
	}
	t.Skip("backend/server/assets holds no built reader (placeholder served); run 'sh scripts/build.sh' to grade the real bundle")
}

// The placeholder is what a Go-only checkout serves. It must be a complete
// page that names the command which fixes it, or the missing bundle shows up
// as a blank tab nobody can act on.
func TestThePlaceholderNamesTheBuildCommand(t *testing.T) {
	page, err := fs.ReadFile(rooted(placeholderFS, "placeholder"), "index.html")
	if err != nil {
		t.Fatalf("the placeholder page is not embedded: %v", err)
	}
	for _, want := range []string{"sh scripts/build.sh", "go generate ./backend/server"} {
		if !strings.Contains(string(page), want) {
			t.Errorf("the placeholder does not tell the reader to run %q", want)
		}
	}
}

// The server's CSP refuses an inline <style> element (style-src-elem 'self'),
// so a placeholder that styled itself inline would arrive unstyled. Served
// through the real handler, the page carries no style element, and the
// stylesheet it links is served from the same origin the policy allows.
func TestThePlaceholderIsStyledOnlyByWhatTheCSPAllows(t *testing.T) {
	srv := httptest.NewServer((&Server{Assets: rooted(placeholderFS, "placeholder")}).Handler())
	defer srv.Close()

	res, err := http.Get(srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(res.Body)
	res.Body.Close()
	// The precondition: this is the placeholder, under the policy.
	if !strings.Contains(string(page), "built without the reader") {
		t.Fatalf("GET / did not serve the placeholder:\n%s", page)
	}
	csp := res.Header.Get("Content-Security-Policy")
	if !strings.Contains(csp, "style-src-elem 'self'") {
		t.Fatalf("the placeholder is not served under the reader's CSP: %q", csp)
	}
	if strings.Contains(strings.ToLower(string(page)), "<style") {
		t.Error("the placeholder carries an inline <style> element, which the CSP refuses")
	}
	if !strings.Contains(string(page), `<link rel="stylesheet" href="/placeholder.css">`) {
		t.Fatal("the placeholder does not link its stylesheet")
	}

	css, err := http.Get(srv.URL + "/placeholder.css")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(css.Body)
	css.Body.Close()
	if css.StatusCode != http.StatusOK || !strings.HasPrefix(css.Header.Get("Content-Type"), "text/css") {
		t.Fatalf("GET /placeholder.css = %d %q", css.StatusCode, css.Header.Get("Content-Type"))
	}
	if !strings.Contains(string(body), "max-width") {
		t.Errorf("the linked stylesheet is not the placeholder's: %q", body)
	}
}

// What is served and what the status row grades must agree about the bundle:
// with no built reader the served page is the placeholder, and BuiltAssets
// (which 'facet setup status' stats) has no index page, so the status row goes
// red instead of calling a placeholder a reader.
func TestServedAssetsAndBuiltAssetsAgreeAboutTheReader(t *testing.T) {
	_, builtErr := fs.Stat(BuiltAssets(), "index.html")
	if ReaderBuilt() != (builtErr == nil) {
		t.Fatalf("ReaderBuilt() is %v but stat index.html on BuiltAssets says %v", ReaderBuilt(), builtErr)
	}
	served, err := fs.ReadFile(Assets(), "index.html")
	if err != nil {
		t.Fatalf("Assets() has no index page: %v", err)
	}
	isPlaceholder := strings.Contains(string(served), "built without the reader")
	if ReaderBuilt() && isPlaceholder {
		t.Error("a reader is built and Assets() still serves the placeholder")
	}
	if !ReaderBuilt() && !isPlaceholder {
		t.Error("no reader is built and Assets() does not serve the placeholder")
	}
}
