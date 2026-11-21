package server

import (
	"golang.org/x/net/html"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
)

// Required CSP directives constrain script and resource sources.
// Same-origin plugin modules share the host realm; this is not a plugin sandbox.
// Check directives individually so additions pass and removals fail.
var requiredDirectives = []string{
	"default-src 'self'",
	"script-src 'self'",
	"connect-src 'self'",
	"font-src 'self'",
	"style-src 'self'",
	"style-src-elem 'self'",
	"frame-ancestors 'none'",
	"base-uri 'self'",
}

// servePage asks the reader for its entry page the way a browser does.
func servePage(t *testing.T) *http.Response {
	t.Helper()
	s := &Server{}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, loopbackRequest(http.MethodGet, "/", nil))
	return rec.Result()
}

func TestTheReaderServesAContentSecurityPolicy(t *testing.T) {
	got := servePage(t).Header.Get("Content-Security-Policy")

	if got == "" {
		t.Fatal("no Content-Security-Policy on the entry page: script and resource sources must be restricted")
	}
	for _, want := range requiredDirectives {
		if !strings.Contains(got, want) {
			t.Errorf("policy is missing %q\n  got: %s", want, got)
		}
	}
}

// script-src without 'unsafe-inline' and without 'unsafe-eval' is the whole
// point of the directive. With either, a plugin writes a <script> element or
// calls eval and the policy has bought nothing.
func TestTheScriptPolicyAllowsNeitherInlineNorEval(t *testing.T) {
	got := servePage(t).Header.Get("Content-Security-Policy")
	if got == "" {
		t.Fatal("no policy at all, so this case measures nothing")
	}

	scripts := ""
	for _, part := range strings.Split(got, ";") {
		if strings.HasPrefix(strings.TrimSpace(part), "script-src") {
			scripts = strings.TrimSpace(part)
		}
	}
	if scripts == "" {
		t.Fatal("the policy names no script-src, so nothing constrains a plugin's scripts")
	}
	if strings.Contains(scripts, "unsafe-inline") {
		t.Errorf("script-src allows inline script: %s", scripts)
	}
	if strings.Contains(scripts, "unsafe-eval") {
		t.Errorf("script-src allows eval: %s", scripts)
	}
}

// The bundle must be servable under the policy it is served with. An inline
// script in index.html would be refused by the browser and the page would come
// up unstyled or not at all — and nothing on the Go side would notice, because
// the header and the bundle are checked by nobody together.
func TestTheEntryPageCarriesNoInlineScript(t *testing.T) {
	requireBuiltReader(t)
	res := servePage(t)
	if res.StatusCode != http.StatusOK {
		t.Skipf("no bundle in this build (status %d), so there is no document to judge", res.StatusCode)
	}
	body := make([]byte, 64*1024)
	n, _ := res.Body.Read(body)
	page := string(body[:n])

	if !strings.Contains(page, "<script") {
		t.Fatal("the entry page carries no script tag at all, so this case measures something else")
	}
	// Every script tag must name a source. A tag without src carries its code
	// in the document, which script-src 'self' refuses.
	for _, tag := range strings.Split(page, "<script")[1:] {
		head, _, ok := strings.Cut(tag, ">")
		if !ok {
			continue
		}
		if !strings.Contains(head, "src=") {
			t.Errorf("inline script in the entry page, which script-src 'self' refuses: <script%s>", head)
		}
	}
}

func TestTheEntryPageAsksNoThirdPartyForFonts(t *testing.T) {
	requireBuiltReader(t)
	res := servePage(t)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("reader entry page missing: status %d", res.StatusCode)
	}
	document, err := html.Parse(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	references := 0
	var visit func(*html.Node)
	visit = func(node *html.Node) {
		if node.Type == html.ElementNode {
			for _, attr := range node.Attr {
				switch attr.Key {
				case "src", "href", "action", "poster", "data":
					references++
					target, err := url.Parse(strings.TrimSpace(attr.Val))
					if err != nil {
						t.Fatalf("invalid resource URL: %v", err)
					}
					if target.Host != "" && target.Host != loopbackTestHost {
						t.Errorf("entry page references foreign origin %q in %s.%s", target.Host, node.Data, attr.Key)
					}
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(document)
	if references < 2 {
		t.Fatalf("expected actual stylesheet/script references, got %d", references)
	}
}

// directive pulls one directive out of the policy, matched on its name and not
// on a substring: "style-src" is a prefix of "style-src-elem", and a check that
// did not tell them apart would read the wrong one and say nothing.
func directive(policy, name string) string {
	for _, part := range strings.Split(policy, ";") {
		part = strings.TrimSpace(part)
		if part == name || strings.HasPrefix(part, name+" ") {
			return part
		}
	}
	return ""
}

func TestTheStylePolicyRefusesAnInlineStylesheet(t *testing.T) {
	got := servePage(t).Header.Get("Content-Security-Policy")
	if got == "" {
		t.Fatal("no policy at all, so this case measures nothing")
	}

	for _, name := range []string{"style-src", "style-src-elem"} {
		d := directive(got, name)
		if d == "" {
			t.Errorf("the policy names no %s, so nothing constrains a plugin's stylesheets", name)
			continue
		}
		if strings.Contains(d, "unsafe-inline") {
			t.Errorf("%s allows an inline stylesheet: %s", name, d)
		}
	}

	// The premise of the two checks above: the helper has to be able to see an
	// 'unsafe-inline' where there is one. Without this, a helper that returned
	// the empty string for everything would leave them both green.
	if d := directive(got, "style-src-attr"); !strings.Contains(d, "unsafe-inline") {
		t.Errorf("style-src-attr was expected to carry 'unsafe-inline' for React's style props, and does not: %q", d)
	}
}

// The bundle has to be servable under the policy it is served with. An inline
// <style> element in it would be refused by the browser and the surface would
// come up part-styled — and nothing on the Go side would notice, because the
// header and the bundle are checked by nobody together.
func TestTheEntryPageCarriesNoInlineStyleElement(t *testing.T) {
	requireBuiltReader(t)
	res := servePage(t)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("reader entry page missing: status %d", res.StatusCode)
	}
	document, err := html.Parse(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	stylesheets := 0
	var visit func(*html.Node)
	visit = func(node *html.Node) {
		if node.Type == html.ElementNode {
			if node.Data == "style" {
				t.Error("entry page carries an inline style element refused by its CSP")
			}
			if node.Data == "link" {
				for _, attr := range node.Attr {
					if attr.Key == "rel" && attr.Val == "stylesheet" {
						stylesheets++
					}
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			visit(child)
		}
	}
	visit(document)
	if stylesheets == 0 {
		t.Fatal("entry page references no stylesheet, so absence of inline style is vacuous")
	}
}

func TestTheServedStylesheetCarriesThePalettesAndNoSkinLayer(t *testing.T) {
	requireBuiltReader(t)
	s := &Server{}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, loopbackRequest(http.MethodGet, "/atlas.css", nil))
	res := rec.Result()
	if res.StatusCode != http.StatusOK {
		t.Skipf("no bundle in this build (status %d)", res.StatusCode)
	}
	sheet, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("reading the served stylesheet: %v", err)
	}
	css := string(sheet)

	// The premise first: a truncated or empty read would fail the checks below
	// for a reason that has nothing to do with the palettes.
	if !strings.Contains(css, "--t-ground") {
		t.Fatal("the served stylesheet does not carry the design system's tokens, so this case measures something else")
	}

	for _, palette := range []string{"facet", "paper"} {
		for _, mode := range []string{"light", "dark"} {
			want := regexp.MustCompile(`\[data-t-theme=["']?` + palette + `["']?\]\[data-t-mode=["']?` + mode + `["']?\]`)
			if !want.MatchString(css) {
				t.Errorf("the served stylesheet has no block for %s/%s", palette, mode)
			}
		}
	}
	// Plugin palettes are supplied at runtime.
	if strings.Contains(css, "data-facet-skin") {
		t.Error("the served stylesheet still carries a data-facet-skin rule")
	}
}
