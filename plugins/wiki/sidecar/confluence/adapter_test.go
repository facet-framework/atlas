// Fixtures here are real Confluence storage-format payloads, recorded from the
// live instance named in the pull request; the file demonstrates the adapter's
// decisions rather than implementing anything, so it opts out of scanning.
// @facet-ignore-file

package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
	"github.com/facet-framework/core/registry"
)

const onboardingPage = `---
title: First day with FACET
category: onboarding
order: 1
---

Welcome.
`

// The storage format below is what Confluence actually returns for
// body-format=storage. It is kept as a literal rather than generated, because
// the point of a fixture is to hold what the far side said on a day somebody
// looked — a generated one would only hold what this code expects.
const (
	// A page with the four things that hurt: a table, a code macro, a nested
	// list and a macro with no equivalent.
	storageWithEverything = `<p>The opening paragraph.</p>` +
		`<table><tbody><tr><th>Field</th><th>Meaning</th></tr>` +
		`<tr><td>target</td><td>mirror destination</td></tr></tbody></table>` +
		`<ac:structured-macro ac:name="code" ac:schema-version="1" ac:macro-id="a1">` +
		`<ac:parameter ac:name="language">go</ac:parameter>` +
		`<ac:plain-text-body><![CDATA[func main() { println("hi") }]]></ac:plain-text-body>` +
		`</ac:structured-macro>` +
		`<ul><li>one<ul><li>one-a</li></ul></li><li>two</li></ul>` +
		`<ac:structured-macro ac:name="jira" ac:schema-version="1" ac:macro-id="b2">` +
		`<ac:parameter ac:name="key">FACET-1</ac:parameter></ac:structured-macro>` +
		`<p><ac:link><ri:page ri:content-title="Second Page"/>` +
		`<ac:plain-text-link-body><![CDATA[to the second page]]></ac:plain-text-link-body></ac:link></p>`

	storagePlain = `<p>Plain text.</p>`
)

// fakeConfluence stands in for the instance so the suite needs no network.
//
// It is a transport, not a second implementation: every request the adapter
// makes goes through the real client, the real URL building and the real JSON
// decoding, and only the bytes on the wire are recorded rather than fetched. A
// fake that answered at the adapter's own level would agree with it by
// construction and prove nothing.
type fakeConfluence struct {
	// pages is the far side's state, by id.
	pages map[string]*confluencePage
	// spaceID and spaceKey are the one space it holds.
	spaceID, spaceKey string
	// nextID hands out ids for created pages.
	nextID int
	// deleted records what the run removed, so a cleanup can be checked.
	deleted []string
	// failCreateAfter makes the far side stop answering once this many pages
	// have been created, so a half-finished run can be staged.
	failCreateAfter int
	// created counts successful page creations.
	created int
}

func newFakeConfluence(t *testing.T) (*ConfluenceSource, *fakeConfluence) {
	t.Helper()
	far := &fakeConfluence{
		pages:    map[string]*confluencePage{},
		spaceID:  "9001",
		spaceKey: "ENG",
		nextID:   100,
	}
	src := &ConfluenceSource{
		client: &confluenceClient{base: "https://example.invalid", http: far.httpClient()},
		space:  far.spaceKey,
	}
	src.calls = func() int { return src.client.calls }
	return src, far
}

// add puts a page on the far side.
func (f *fakeConfluence) add(id, title, parentID, storage string) *confluencePage {
	page := &confluencePage{ID: id, Title: title, ParentID: parentID, SpaceID: f.spaceID, Status: "current"}
	page.Version.Number = 1
	page.Body.Storage.Value = storage
	page.Body.Storage.Representation = "storage"
	page.Links.WebUI = "/spaces/" + f.spaceKey + "/pages/" + id
	f.pages[id] = page
	return page
}

func confluenceProject(t *testing.T, files map[string]string) facet.Registry {
	t.Helper()
	root := t.TempDir()
	// A fixture without Git must not inherit a repository above its temporary directory.
	t.Setenv("GIT_CEILING_DIRECTORIES", filepath.Dir(root))
	confluenceMustWrite(t, filepath.Join(root, "docs/facets/features/logistics/booking/release.yaml"),
		`schema_version: "0.1"
id: logistics/booking/release
lifecycle: active
intent:
  summary: |
    Releases a booking.
contract:
  scenarios:
    - id: release-marks-the-booking
      statement: |
        Given a booking
        When it is released
        Then it is marked released
    - id: release-is-refused-twice
      statement: |
        Given a released booking
        When it is released again
        Then the second attempt is refused
lineage:
  owner:
    team: logistics
  created_at: "2026-09-16"
`)
	for rel, body := range files {
		if body == "" {
			continue
		}
		confluenceMustWrite(t, filepath.Join(root, "docs/facets/wiki", rel), body)
	}
	return facet.Open(root)
}

func gitWikiProject(t *testing.T) facet.Registry {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not on PATH")
	}
	reg := confluenceProject(t, map[string]string{
		"wiki.yaml":               "schema_version: \"1.0\"\nbereiche:\n  onboarding:\n    title: Onboarding\n",
		"onboarding/first-day.md": onboardingPage,
	})
	confluenceGit(t, reg.Root, "init", "--initial-branch=main")
	confluenceGit(t, reg.Root, "config", "user.email", "test@example.invalid")
	confluenceGit(t, reg.Root, "config", "user.name", "Test")
	confluenceGit(t, reg.Root, "add", "-A")
	confluenceGit(t, reg.Root, "commit", "-m", "initial")
	return reg
}

// confluenceGit runs one git command against a fixture, failing the test on
// any non-zero exit.
func confluenceGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

func confluenceMustWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// An import of a space lands every page under one area, and the tree keeps its
// shape: a page with children becomes a folder with that page as its index.
func TestASpaceBecomesPagesUnderOneArea(t *testing.T) {
	reg := confluenceProject(t, nil)
	src, far := newFakeConfluence(t)
	far.add("1", "Handbook", "", storagePlain)
	far.add("2", "First Day", "1", storagePlain)
	far.add("3", "Second Day", "1", storagePlain)

	report, err := wiki.ImportWiki(context.Background(), reg, wiki.WikiDir(reg), src, "confluence:ENG")
	if err != nil {
		t.Fatal(err)
	}

	// The parent has children, so it is its folder's index page; the children
	// sit beside it. A flattened tree would put all three at one level.
	want := []string{
		"eng/handbook/first-day.md",
		"eng/handbook/index.md",
		"eng/handbook/second-day.md",
	}
	got := make([]string, 0, len(report.Pages))
	for _, page := range report.Pages {
		got = append(got, page.Path)
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("the tree did not keep its shape:\n got %v\nwant %v", got, want)
	}
	for _, rel := range want {
		if _, err := os.Stat(filepath.Join(wiki.WikiDir(reg), filepath.FromSlash(rel))); err != nil {
			t.Fatalf("%s is not on disk: %v", rel, err)
		}
	}
}

// The hostile-input case, and the one this whole boundary exists for: a page
// title is whatever somebody typed in Confluence, and this is a legal title.
func TestAPageTitleCannotEscapeTheWiki(t *testing.T) {
	reg := confluenceProject(t, nil)
	src, far := newFakeConfluence(t)
	far.add("1", "../../.github/workflows/release", "", storagePlain)
	far.add("2", "First Day", "", storagePlain)

	report, err := wiki.ImportWiki(context.Background(), reg, wiki.WikiDir(reg), src, "confluence:ENG")
	if err != nil {
		t.Fatal(err)
	}

	if len(report.Pages) != 1 {
		t.Fatalf("imported %d pages, want only the one that is a page: %+v", len(report.Pages), report.Pages)
	}
	if len(report.Refused) != 1 {
		t.Fatalf("the escape what not reported as refused: %+v", report.Refused)
	}
	// The laundering failure specifically: a slugged version of that title would
	// be 'github/workflows/release.md', which the write path would accept.
	if _, err := os.Stat(filepath.Join(reg.Root, ".github")); err == nil {
		t.Fatal("the import wrote outside the wiki")
	}
	if _, err := os.Stat(filepath.Join(wiki.WikiDir(reg), "github")); err == nil {
		t.Fatal("the title was laundered into a legal-looking name inside the wiki")
	}
}

// A macro is named in the report, not counted — and leaves a visible line.
func TestAMacroIsNamedNotCounted(t *testing.T) {
	reg := confluenceProject(t, nil)
	src, far := newFakeConfluence(t)
	far.add("1", "First Day", "", storageWithEverything)

	report, err := wiki.ImportWiki(context.Background(), reg, wiki.WikiDir(reg), src, "confluence:ENG")
	if err != nil {
		t.Fatal(err)
	}

	var named bool
	for _, loss := range report.Lost {
		if loss.What == "macro" && strings.Contains(loss.Why, `"jira"`) {
			named = true
		}
	}
	if !named {
		t.Fatalf("the loss report does not name the macro, only its kind: %+v", report.Lost)
	}
	// The code macro came across, so it is not a loss — reporting it would make
	// a clean import look damaged.
	for _, loss := range report.Lost {
		if strings.Contains(loss.Why, `"code"`) {
			t.Fatalf("a macro that came across what reported as lost: %+v", loss)
		}
	}

	body, err := os.ReadFile(filepath.Join(wiki.WikiDir(reg), "eng", "first-day.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `macro "jira" not carried over`) {
		t.Fatalf("the page carries no visible line about the dropped macro:\n%s", body)
	}
}

// The four hard things survive the conversion.
func TestTheHardMarkupSurvivesTheConversion(t *testing.T) {
	markdown, _, err := ConfluenceToMarkdown(storageWithEverything)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"| Field  |",           // the table, as a table (the converter pads columns)
		"```go",                // the code macro, with its language
		`println("hi")`,        // the code body, out of its CDATA
		"- one-a",              // the nested list, still nested (indented under its parent)
		"[to the second page]", // the link's own text, not the page title
	} {
		if !strings.Contains(markdown, want) {
			t.Errorf("the conversion lost %q:\n%s", want, markdown)
		}
	}
}

// Nothing an import does can produce a record. The refusal is the write path's,
// which is the point: there is one door, not two.
func TestAnImportNeverWritesARecord(t *testing.T) {
	reg := confluenceProject(t, nil)
	src, far := newFakeConfluence(t)
	// Three titles that each aim at a .yaml by a different route.
	far.add("1", "taxonomy.yaml", "", storagePlain)
	far.add("2", "../taxonomy.yaml", "", storagePlain)
	far.add("3", "wiki.yaml", "", storagePlain)

	snapshot := func() map[string]string {
		t.Helper()
		found := map[string]string{}
		err := filepath.Walk(reg.Root, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() {
				return nil
			}
			if filepath.Ext(path) == ".yaml" || filepath.Ext(path) == ".yml" {
				body, err := os.ReadFile(path)
				if err != nil {
					return err
				}
				found[path] = string(body)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		return found
	}
	confluenceMustWrite(t, filepath.Join(reg.Root, "docs/facets/taxonomy.yaml"), "domains: {}\n")
	before := snapshot()

	if _, err := wiki.ImportWiki(context.Background(), reg, wiki.WikiDir(reg), src, "confluence:ENG"); err != nil {
		t.Fatal(err)
	}

	if after := snapshot(); !reflect.DeepEqual(before, after) {
		t.Fatalf("import created or changed YAML anywhere: before=%v after=%v", before, after)
	}

}

// A hierarchy goes out as a hierarchy: the index page becomes the parent and
// the others become its children.
func TestAHierarchyGoesOutAsAHierarchy(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/index.md":      "---\ntitle: Handbook\n---\n\nDie Vorderseite.\n",
		"handbook/first-day.md":  "---\ntitle: First Day\n---\n\nText.\n",
		"handbook/second-day.md": "---\ntitle: Second Day\n---\n\nText.\n",
	})
	src, far := newFakeConfluence(t)

	report, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Pushed) != 3 {
		t.Fatalf("pushed %v, want all three pages", report.Pushed)
	}

	parent := far.byTitle(t, "Handbook")
	for _, title := range []string{"First Day", "Second Day"} {
		child := far.byTitle(t, title)
		if child.ParentID != parent.ID {
			t.Fatalf("%q hangs under %q, want under the index page %q",
				title, child.ParentID, parent.ID)
		}
	}
	if parent.ParentID != "" {
		t.Fatalf("the index page hangs under %q, want at the top of the space", parent.ParentID)
	}
}

// Detect, refuse, report — with both identifiers named.
func TestAPageChangedInConfluenceIsNotOverwritten(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/first-day.md": "---\ntitle: First Day\n---\n\nText.\n",
	})
	src, far := newFakeConfluence(t)
	if _, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src); err != nil {
		t.Fatal(err)
	}

	// Somebody saves over there, and the page changes here too.
	remote := far.byTitle(t, "First Day")
	remote.Version.Number++
	remote.Body.Storage.Value = "<p>Changed remotely.</p>"
	if _, err := wiki.WriteWikiPage(reg, wiki.WikiDir(reg), "handbook/first-day.md",
		"---\ntitle: First Day\n---\n\nChanged here.\n"); err != nil {
		t.Fatal(err)
	}

	report, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Conflicts) != 1 {
		t.Fatalf("the conflict what not reported: %+v", report)
	}
	if report.Conflicts[0].RemoteID == "" || report.Conflicts[0].Page == "" {
		t.Fatalf("the conflict does not name both identifiers: %+v", report.Conflicts[0])
	}
	if got := far.byTitle(t, "First Day").Body.Storage.Value; got != "<p>Changed remotely.</p>" {
		t.Fatalf("the conflicted page what overwritten: %q", got)
	}
	if len(report.Pushed) != 0 {
		t.Fatalf("something what pushed during a conflict: %v", report.Pushed)
	}
}

// A no-op push must leave the digest matching, or the conflict rule is noise.
//
// This is the fixture half of the RemoteDigest question. The live half is in
// wiki_confluence_live_test.go: a fixture can prove the adapter compares the
// right field, and only the real instance can prove that field holds still.
func TestANoOpPushLeavesTheDigestMatching(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/first-day.md": "---\ntitle: First Day\n---\n\nText.\n",
	})
	src, far := newFakeConfluence(t)
	if _, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src); err != nil {
		t.Fatal(err)
	}
	// Confluence normalises storage format on save. The fake does the same, so
	// a digest taken over the body would move here exactly as it moves there.
	far.byTitle(t, "First Day").Body.Storage.Value += "<!-- normalised by confluence -->"

	report, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Conflicts) != 0 {
		t.Fatalf("a no-op push reported a conflict nobody caused: %+v", report.Conflicts)
	}
	if len(report.Unchanged) != 1 {
		t.Fatalf("the second run does not report the page as unchanged: %+v", report)
	}
}

// One wiki, one target — the second is refused rather than silently resetting
// the first target's digests.
func TestASecondTargetIsRefusedRatherThanForgotten(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/first-day.md": "---\ntitle: First Day\n---\n\nText.\n",
	})
	first, _ := newFakeConfluence(t)
	if _, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), first); err != nil {
		t.Fatal(err)
	}

	before, err := os.ReadFile(filepath.Join(wiki.WikiDir(reg), wiki.WikiMirrorStateName))
	if err != nil {
		t.Fatal(err)
	}

	second, far := newFakeConfluence(t)
	second.space = "OPS"
	far.spaceKey = "OPS"
	_, err = wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), second)
	if !errors.Is(err, ErrConfluenceOtherTarget) {
		t.Fatalf("mirroring to a second target = %v, want ErrConfluenceOtherTarget", err)
	}
	if !strings.Contains(err.Error(), "confluence:ENG") || !strings.Contains(err.Error(), "confluence:OPS") {
		t.Fatalf("the refusal does not name both targets: %v", err)
	}

	after, err := os.ReadFile(filepath.Join(wiki.WikiDir(reg), wiki.WikiMirrorStateName))
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatalf("the refused run replaced the first target's state:\n%s", after)
	}
}

// 'imported' reads as 'connected'. A second import has to say otherwise.
func TestARepeatedImportSaysItOverwrites(t *testing.T) {
	reg := confluenceProject(t, nil)
	src, far := newFakeConfluence(t)
	far.add("1", "First Day", "", storagePlain)

	if _, err := wiki.ImportWiki(context.Background(), reg, wiki.WikiDir(reg), src, "confluence:ENG"); err != nil {
		t.Fatal(err)
	}
	// Somebody edits the imported page here, believing Confluence will follow.
	if _, err := wiki.WriteWikiPage(reg, wiki.WikiDir(reg), "eng/first-day.md",
		"---\ntitle: First Day\n---\n\nAdded here.\n"); err != nil {
		t.Fatal(err)
	}

	report, err := wiki.ImportWiki(context.Background(), reg, wiki.WikiDir(reg), src, "confluence:ENG")
	if err != nil {
		t.Fatal(err)
	}

	var warned bool
	for _, loss := range report.Lost {
		if strings.Contains(loss.Why, "'imported' does not mean 'connected'") {
			warned = true
		}
	}
	if !warned {
		t.Fatalf("a repeated import said nothing about overwriting local edits: %+v", report.Lost)
	}
	// And it is true: the local edit is absent.
	body, err := os.ReadFile(filepath.Join(wiki.WikiDir(reg), "eng", "first-day.md"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "Added here") {
		t.Fatal("the warning is wrong — the local edit survived, so the sentence overstates")
	}
}

// Two pages wanting one Confluence title: refused with both paths, never
// suffixed, because a title is prose somebody wrote.
func TestTwoPagesWantingOneTitleAreRefused(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/voraussetzungen.md": "---\ntitle: Voraussetzungen\n---\n\nText.\n",
		"guideen/voraussetzungen.md":  "---\ntitle: Voraussetzungen\n---\n\nText.\n",
	})
	src, far := newFakeConfluence(t)

	report, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Conflicts) != 2 {
		t.Fatalf("the title collision what not reported for both pages: %+v", report.Conflicts)
	}
	for _, conflict := range report.Conflicts {
		if !strings.Contains(conflict.Why, "handbook/voraussetzungen.md") ||
			!strings.Contains(conflict.Why, "guideen/voraussetzungen.md") {
			t.Fatalf("the refusal does not name both paths: %+v", conflict)
		}
	}
	if len(far.pages) != 0 {
		t.Fatalf("a page what created despite the collision: %d", len(far.pages))
	}
}

// A page deleted in Confluence is not re-created: the mirror does not undo
// somebody's deletion in a system it does not own.
func TestAPageDeletedInConfluenceIsNotRecreated(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/first-day.md": "---\ntitle: First Day\n---\n\nText.\n",
	})
	src, far := newFakeConfluence(t)
	if _, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src); err != nil {
		t.Fatal(err)
	}

	remote := far.byTitle(t, "First Day")
	delete(far.pages, remote.ID)
	if _, err := wiki.WriteWikiPage(reg, wiki.WikiDir(reg), "handbook/first-day.md",
		"---\ntitle: First Day\n---\n\nChanged here.\n"); err != nil {
		t.Fatal(err)
	}

	report, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err != nil {
		t.Fatal(err)
	}
	if len(far.pages) != 0 {
		t.Fatalf("the mirror re-created a page somebody deleted: %d", len(far.pages))
	}
	if len(report.Conflicts) != 1 || !strings.Contains(report.Conflicts[0].Why, "404") {
		t.Fatalf("the deletion what not reported with its status: %+v", report.Conflicts)
	}
}

// Markdown out: every piece of text is escaped, because storage format is XHTML
// and a page with an ampersand in it would otherwise be a document Confluence
// rejects.
func TestMarkdownToConfluenceEscapesText(t *testing.T) {
	storage, err := MarkdownToConfluence("Tom & Jerry <script>alert(1)</script>\n\n## Heading\n")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(storage, "<script>") {
		t.Fatalf("raw HTML what passed through into storage format:\n%s", storage)
	}
	if !strings.Contains(storage, "Tom &amp; Jerry") {
		t.Fatalf("an ampersand what not escaped:\n%s", storage)
	}
	if !strings.Contains(storage, "<h2>Heading</h2>") {
		t.Fatalf("the heading did not survive:\n%s", storage)
	}
}

// A code fence goes out as the code macro, with its language and its body
// inside CDATA.
func TestMarkdownToConfluenceWritesTheCodeMacro(t *testing.T) {
	storage, err := MarkdownToConfluence("```go\nfunc main() {}\n```\n")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`ac:name="code"`,
		`ac:name="language">go<`,
		`<![CDATA[func main() {}`,
	} {
		if !strings.Contains(storage, want) {
			t.Fatalf("the code fence lost %q:\n%s", want, storage)
		}
	}
}

// A credential is read from the environment and the error names what is
// missing — never what was found.
func TestMissingCredentialsNameTheVariables(t *testing.T) {
	t.Setenv(ConfluenceURLEnv, "")
	t.Setenv(ConfluenceEmailEnv, "")
	t.Setenv(ConfluenceTokenEnv, "")

	_, err := NewConfluenceSource("ENG")
	if !errors.Is(err, ErrConfluenceNoCredentials) {
		t.Fatalf("building a source without credentials = %v, want ErrConfluenceNoCredentials", err)
	}
	for _, name := range []string{ConfluenceURLEnv, ConfluenceEmailEnv, ConfluenceTokenEnv} {
		if !strings.Contains(err.Error(), name) {
			t.Fatalf("the error does not name %s: %v", name, err)
		}
	}

	// And with two of three present, only the missing one is named — and the
	// value of the present one never appears.
	t.Setenv(ConfluenceURLEnv, "https://example.invalid")
	t.Setenv(ConfluenceTokenEnv, "a-secret-that-must-not-be-printed")
	_, err = NewConfluenceSource("ENG")
	if err == nil || !strings.Contains(err.Error(), ConfluenceEmailEnv) {
		t.Fatalf("the error does not name the one missing variable: %v", err)
	}
	if strings.Contains(err.Error(), "a-secret-that-must-not-be-printed") {
		t.Fatalf("the error printed a credential: %v", err)
	}
}

// A reference is claimed only when it is this source's.
func TestConfluenceDetectsItsOwnReferences(t *testing.T) {
	src := &ConfluenceSource{}
	for _, ref := range []string{
		"confluence:ENG",
		"https://example.atlassian.net/wiki/spaces/ENG",
		"https://example.atlassian.net/wiki/spaces/ENG/pages/4711/First+Day",
	} {
		if !src.Detect(ref) {
			t.Errorf("Detect(%q) = false, want true", ref)
		}
	}
	for _, ref := range []string{
		"obsidian:/vault",
		// A bare space key belongs to nobody: claiming it would take references
		// meant for another source.
		"ENG",
		"https://example.com/some/page",
	} {
		if src.Detect(ref) {
			t.Errorf("Detect(%q) = true, want false", ref)
		}
	}
}

// The three shapes a reference takes, and the subtree marker.
func TestParseConfluenceRef(t *testing.T) {
	cases := map[string]confluenceRef{
		"confluence:ENG":   {spaceKey: "ENG"},
		"confluence:4711":  {pageID: "4711"},
		"confluence:4711+": {pageID: "4711", subtree: true},
		"https://example.atlassian.net/wiki/spaces/ENG/pages/4711/Title": {pageID: "4711"},
		"https://example.atlassian.net/wiki/spaces/ENG":                  {spaceKey: "ENG"},
	}
	for in, want := range cases {
		got, err := ParseConfluenceRef(in)
		if err != nil {
			t.Errorf("ParseConfluenceRef(%q): %v", in, err)
			continue
		}
		if got != want {
			t.Errorf("ParseConfluenceRef(%q) = %+v, want %+v", in, got, want)
		}
	}
}

// A state file that names another target comes back empty but still says what
// it displaced — which is the only thing that lets a source refuse rather than
// replace the first target's digests with nothing anywhere saying so.
func TestADisplacedTargetIsStillNamed(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/first-day.md": "---\ntitle: First Day\n---\n\nText.\n",
	})
	state := &wiki.WikiMirrorState{Target: "confluence:ENG"}
	state.Record("handbook/first-day.md", wiki.WikiMirrorEntry{
		Digest: "abc", RemoteID: "4711", RemoteDigest: "v1",
	})
	if err := wiki.SaveWikiMirrorState(wiki.WikiDir(reg), state); err != nil {
		t.Fatal(err)
	}

	loaded, err := wiki.LoadWikiMirrorState(wiki.WikiDir(reg), "confluence:OPS")
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Entries) != 0 {
		t.Fatalf("a foreign target's digests were reused: %+v", loaded.Entries)
	}
	if loaded.DisplacedTarget != "confluence:ENG" {
		t.Fatalf("the displaced target is not named: %q — a source cannot then tell "+
			"a second target from a first run", loaded.DisplacedTarget)
	}

	// A state that pushed nothing protects nothing, so it names no displacement.
	empty := &wiki.WikiMirrorState{Target: "confluence:ENG", Entries: map[string]wiki.WikiMirrorEntry{}}
	if err := wiki.SaveWikiMirrorState(wiki.WikiDir(reg), empty); err != nil {
		t.Fatal(err)
	}
	loaded, err = wiki.LoadWikiMirrorState(wiki.WikiDir(reg), "confluence:OPS")
	if err != nil {
		t.Fatal(err)
	}
	if loaded.DisplacedTarget != "" {
		t.Fatalf("a state with no entries claimed a displacement: %q", loaded.DisplacedTarget)
	}
}

// An embedding goes out as a native Confluence form — a panel, searchable and
// copyable — rather than as an image nobody can search or read in dark mode.
func TestAnEmbeddingGoesOutAsANativeForm(t *testing.T) {
	page := "Opening text.\n\n```atlas\ncomponent: ProofMatrix\nrecord: registry/layout/source-scanning\n```\n\nClosing text.\n"

	storage, embeds, err := MarkdownToConfluenceWithEmbeds(page, "wiki:features/scanning")
	if err != nil {
		t.Fatal(err)
	}
	if len(embeds) != 1 {
		t.Fatalf("the embedding what not recognised: %+v", embeds)
	}
	if !strings.Contains(storage, `ac:name="info"`) {
		t.Errorf("the embedding is not a native Confluence form:\n%s", storage)
	}
	// The component and what it points at, so a reader over there can go and
	// look rather than seeing an empty space.
	for _, want := range []string{"ProofMatrix", "registry/layout/source-scanning", "wiki:features/scanning"} {
		if !strings.Contains(storage, want) {
			t.Errorf("the panel does not name %q:\n%s", want, storage)
		}
	}
	// And not as a raw YAML block dumped into somebody's handbook.
	if strings.Contains(storage, "component:") {
		t.Errorf("the raw block what pushed through as text:\n%s", storage)
	}
	if strings.Contains(storage, "Opening text") == false || strings.Contains(storage, "Closing text") == false {
		t.Errorf("the prose around the embedding what lost:\n%s", storage)
	}
}

// An embedding is a loss, named by component — the macro rule, in the other
// direction.
func TestAnEmbeddingIsNamedInTheLossReport(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/first-day.md": "---\ntitle: First Day\n---\n\n" +
			"```atlas\ncomponent: ProofMatrix\nrecord: registry/layout/source-scanning\n```\n",
	})
	src, _ := newFakeConfluence(t)

	report, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.EmbedLosses) != 1 {
		t.Fatalf("the embedding what not reported as a loss: %+v", report.EmbedLosses)
	}
	loss := report.EmbedLosses[0]
	if !strings.Contains(loss.Why, "ProofMatrix") {
		t.Errorf("the loss does not name the component, only its kind: %+v", loss)
	}
	if !strings.Contains(loss.Why, "registry/layout/source-scanning") {
		t.Errorf("the loss does not name what the view what over: %+v", loss)
	}
	if loss.Page == "" || loss.What == "" {
		t.Errorf("the loss does not say page and what: %+v", loss)
	}
}

// A page holding an embedding must be unchanged on a second run, and the
// rendering of an embedding must be deterministic.
//
// The two are checked together and are not the same check. "Unchanged" is judged
// on the digest of the file on disk, so a per-run value in the panel would not
// show up as an extra push — it would be written once, on the first push, and
// then frozen, because no later run pushes an unchanged page. That is the
// quieter failure: a timestamp in Confluence that looks current forever and
// describes when the mirror first ran. The determinism assertion below is what
// catches it; the mirror assertion catches anything that makes the file itself
// look changed.
func TestAnEmbeddingDoesNotMakeEveryRunAChange(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/first-day.md": "---\ntitle: First Day\n---\n\n" +
			"```atlas\ncomponent: ProofMatrix\nrecord: registry/layout/source-scanning\n```\n",
	})
	src, far := newFakeConfluence(t)

	first, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Pushed) != 1 {
		t.Fatalf("the first run pushed %v, want the one page", first.Pushed)
	}
	pushedBody := far.byTitle(t, "First Day").Body.Storage.Value

	second, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Pushed) != 0 {
		t.Fatalf("a page with an embedding pushed again on a no-op run: %v", second.Pushed)
	}
	if len(second.Unchanged) != 1 {
		t.Fatalf("the page with an embedding what not reported unchanged: %+v", second)
	}
	if got := far.byTitle(t, "First Day").Body.Storage.Value; got != pushedBody {
		t.Fatalf("the far side's body moved without a push:\n%q\n%q", pushedBody, got)
	}

	// And the rendering itself is stable, checked directly rather than through
	// the mirror — so a future change that reintroduces a per-run value fails
	// here with the reason rather than as a mysterious extra push.
	body := "```atlas\ncomponent: ProofMatrix\nrecord: a/b/c\n```\n"
	one, _, err := MarkdownToConfluenceWithEmbeds(body, "wiki:x")
	if err != nil {
		t.Fatal(err)
	}
	two, _, err := MarkdownToConfluenceWithEmbeds(body, "wiki:x")
	if err != nil {
		t.Fatal(err)
	}

	// Reject dates/times even when both immediate renderings happen in one minute.
	if regexp.MustCompile(`\b(?:19|20)\d{2}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b`).MatchString(one) {
		t.Fatalf("embedding invents a date or timestamp: %s", one)
	}
	if one != two {
		t.Fatalf("rendering an embedding twice gave two answers:\n%q\n%q", one, two)
	}
}

// A panel coming back in is ordinary text, and never guessed back into an
// embedding — a selector reconstructed from a table would be an invented
// measurement.
func TestAPanelDoesNotBecomeAnEmbeddingAgain(t *testing.T) {
	storage, _, err := MarkdownToConfluenceWithEmbeds(
		"```atlas\ncomponent: ProofMatrix\nrecord: a/b/c\n```\n", "wiki:x")
	if err != nil {
		t.Fatal(err)
	}

	markdown, macros, err := ConfluenceToMarkdown(storage)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(markdown, "```atlas") {
		t.Fatalf("a panel what guessed back into a live embedding:\n%s", markdown)
	}
	// It came back as prose, which is what it is: somebody may have edited it
	// over there, and the converted panel is prose.
	if !strings.Contains(markdown, "ProofMatrix") {
		t.Errorf("the panel's text what dropped entirely:\n%s", markdown)
	}
	_ = macros
}

// A self-closing macro must not swallow what follows it.
//
// Storage format writes a parameterless macro as <ac:structured-macro ac:name="toc"/>,
// and an HTML parser does not honour self-closing on an element it does not
// know — so everything after it becomes its child. Found against the live
// instance, where a page whose 'toc' sat above a code block arrived with the
// code block simply gone, and no loss entry to say so: the content was not
// dropped by a rule, it was never seen.
func TestASelfClosingMacroDoesNotSwallowWhatFollows(t *testing.T) {
	markdown, macros, err := ConfluenceToMarkdown(
		`<p>Before.</p>` +
			`<ac:structured-macro ac:name="toc" ac:schema-version="1"/>` +
			`<ac:structured-macro ac:name="code" ac:schema-version="1">` +
			`<ac:plain-text-body><![CDATA[kept := true]]></ac:plain-text-body>` +
			`</ac:structured-macro>` +
			`<p>After.</p>`)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Before.", `macro "toc" not carried over`, "kept := true", "After."} {
		if !strings.Contains(markdown, want) {
			t.Errorf("a self-closing macro swallowed %q:\n%s", want, markdown)
		}
	}
	// Both macros are still seen, so the report can name both.
	var names []string
	for _, macro := range macros {
		names = append(names, macro.Name)
	}
	if len(names) != 2 {
		t.Errorf("the macros found were %v, want both toc and code", names)
	}
}

// A dropped macro's own parameters must not leak into the prose as if somebody
// had typed them: a Jira key is the macro's argument, not the page's text.
func TestADroppedMacrosParametersDoNotBecomeProse(t *testing.T) {
	markdown, _, err := ConfluenceToMarkdown(
		`<ac:structured-macro ac:name="jira" ac:schema-version="1">` +
			`<ac:parameter ac:name="key">FACET-1</ac:parameter>` +
			`</ac:structured-macro>`)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(markdown, "FACET-1") {
		t.Errorf("a dropped macro's parameter leaked into the prose:\n%s", markdown)
	}
	if !strings.Contains(markdown, `macro "jira" not carried over`) {
		t.Errorf("the visible line is missing:\n%s", markdown)
	}
}

// A page's header must never reach Confluence as text.
//
// Asserted on the HEAD of the storage body rather than by searching it for a
// word, which is why this was missed: every other assertion about a pushed body
// looks for something from the prose, and a header bolted to the front passes
// all of them. CommonMark reads '---' as a rule and the keys under it as a
// setext heading, so the page arrives with 'title: …' as an <h2> and nothing
// anywhere reports a problem.
func TestAPagesHeaderNeverReachesConfluence(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/first-day.md": "---\ntitle: First Day\ncategory: guide\n" +
			"tags: [onboarding]\naliases: [\"https://x.atlassian.net/wiki/spaces/ENG/pages/4711\"]\n" +
			"---\n\nA sentence.\n",
	})
	src, far := newFakeConfluence(t)

	if _, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src); err != nil {
		t.Fatal(err)
	}
	stored := far.byTitle(t, "First Day").Body.Storage.Value

	// The head of the body is the page's first prose, not a rule and not a
	// heading made out of YAML.
	if !strings.HasPrefix(stored, "<p>A sentence.</p>") {
		t.Fatalf("the body does not begin with the page's prose:\n%s", stored)
	}
	for _, leak := range []string{"title:", "category:", "tags:", "aliases:", "<hr", "---"} {
		if strings.Contains(stored, leak) {
			t.Errorf("the header leaked into Confluence as %q:\n%s", leak, stored)
		}
	}
}

// The same guard one level down, so a caller that hands over a whole page file
// still cannot push a header.
func TestAWholeFileHandedToTheRendererLosesItsHeader(t *testing.T) {
	storage, _, err := MarkdownToConfluenceWithEmbeds(
		"---\ntitle: First Day\ncategory: guide\n---\n\nA sentence.\n", "wiki:x")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(storage, "<p>A sentence.</p>") {
		t.Fatalf("a whole page file what rendered with its header:\n%s", storage)
	}
	// And a page whose prose legitimately opens with a thematic break keeps it.
	withRule, _, err := MarkdownToConfluenceWithEmbeds("Before.\n\n---\n\nAfter.\n", "wiki:x")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(withRule, "<hr/>") {
		t.Errorf("a deliberate thematic break in the prose what eaten:\n%s", withRule)
	}
}

// A run that fails half way must still own what it pushed.
//
// The failure this pins is not lost work, it is a lie. A source records an entry
// only after the far side has answered, so every entry in hand describes a push
// that happened; discarding them on error threw away the truth about the pages
// that succeeded. Those pages then stand in the target system unclaimed — on the
// next run they are unknown, their titles are taken, and the report says "a page
// with this title already exists and this mirror did not create it", which is
// false and which means they are never touched again.
func TestAHalfFinishedRunStillOwnsWhatItPushed(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/eins.md":  "---\ntitle: Eins\n---\n\nText.\n",
		"handbook/two.md":   "---\ntitle: Two\n---\n\nText.\n",
		"handbook/three.md": "---\ntitle: Three\n---\n\nText.\n",
	})
	src, far := newFakeConfluence(t)
	far.failCreateAfter = 2 // two pages land, the third run into a 500

	_, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err == nil {
		t.Fatal("the failing run reported success")
	}
	if far.created != 2 {
		t.Fatalf("the far side holds %d pages, want the two that succeeded", far.created)
	}

	// The state must name both pages that actually landed.
	state, err := wiki.LoadWikiMirrorState(wiki.WikiDir(reg), src.Name())
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Entries) != 2 {
		t.Fatalf("the state records %d pushes, want the 2 that happened — "+
			"the pages that landed are now orphaned in the target system",
			len(state.Entries))
	}

	// And the next run must not accuse itself of finding somebody else's pages.
	far.failCreateAfter = 0
	report, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err != nil {
		t.Fatal(err)
	}
	for _, conflict := range report.Conflicts {
		if strings.Contains(conflict.Why, "did not create it") {
			t.Fatalf("the second run disowned a page it pushed itself: %+v", conflict)
		}
	}
	// Exactly one page is pushed — the one that had not landed — and the other
	// two are recognised as already pushed. Which of the three failed depends on
	// the plan's order, so the assertion is on the shape rather than on a name.
	if len(report.Pushed) != 1 {
		t.Fatalf("the resumed run pushed %v, want only the page that had failed", report.Pushed)
	}
	if len(report.Unchanged) != 2 {
		t.Fatalf("the two pages that had landed are not reported unchanged: %+v", report)
	}
	for _, pushed := range report.Pushed {
		if _, known := state.Entry(pushed); known {
			t.Errorf("the resumed run re-pushed %s, which the first run had already landed", pushed)
		}
	}
}

// A run that pushed nothing writes nothing — so the second-target refusal still
// cannot be undone by the rule above.
func TestARunThatPushedNothingLeavesTheStateAlone(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/eins.md": "---\ntitle: Eins\n---\n\nText.\n",
	})
	src, far := newFakeConfluence(t)
	far.failCreateAfter = -1 // the very first create fails, so nothing lands

	if _, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src); err == nil {
		t.Fatal("the failing run reported success")
	}
	if _, err := os.Stat(filepath.Join(wiki.WikiDir(reg), wiki.WikiMirrorStateName)); err == nil {
		t.Fatal("a run that pushed nothing wrote a state file")
	}
}

// A container macro loses its wrapper, never its contents.
//
// Dropping the whole macro threw away a section of prose while the loss entry
// said "the expand macro has no equivalent" — which reads as a missing widget,
// not as four missing paragraphs. Same disease as the self-closing macro: the
// content is absent and the report does not know it.
func TestAContainerMacroKeepsItsContents(t *testing.T) {
	markdown, _, err := ConfluenceToMarkdown(
		`<ac:structured-macro ac:name="expand">` +
			`<ac:parameter ac:name="title">More</ac:parameter>` +
			`<ac:rich-text-body><p>A paragraph.</p><ul><li>one</li></ul></ac:rich-text-body>` +
			`</ac:structured-macro>`)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"A paragraph.", "- one", `macro "expand" not carried over`} {
		if !strings.Contains(markdown, want) {
			t.Errorf("a container macro lost %q:\n%s", want, markdown)
		}
	}
	// And the note says the contents survived, so nobody reads the loss as
	// "that section is absent".
	if !strings.Contains(markdown, "the content stands unchanged below") {
		t.Errorf("the note does not say the contents were kept:\n%s", markdown)
	}
}

// A kept macro's body keeps its shape rather than being flattened to one line.
func TestAKeptMacroKeepsItsStructure(t *testing.T) {
	markdown, _, err := ConfluenceToMarkdown(
		`<ac:structured-macro ac:name="info"><ac:rich-text-body>` +
			`<p>First.</p><p>Twoter.</p><ul><li>one</li></ul>` +
			`</ac:rich-text-body></ac:structured-macro>`)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(markdown, "First.Twoter.") {
		t.Fatalf("the panel's paragraphs were run together:\n%s", markdown)
	}
	for _, want := range []string{"First.", "Twoter.", "- one"} {
		if !strings.Contains(markdown, want) {
			t.Errorf("the panel lost %q:\n%s", want, markdown)
		}
	}
}

// An image and a mention are named in the report, not dropped in silence.
func TestAnAttachmentAndAMentionAreReported(t *testing.T) {
	reg := confluenceProject(t, nil)
	src, far := newFakeConfluence(t)
	far.add("1", "With Attachment", "",
		`<p>Before.</p><ac:image><ri:attachment ri:filename="diagram.png"/></ac:image>`+
			`<p>Questions for <ac:link><ri:user ri:account-id="abc123"/></ac:link>.</p>`)

	report, err := wiki.ImportWiki(context.Background(), reg, wiki.WikiDir(reg), src, "confluence:ENG")
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]string{}
	for _, loss := range report.Lost {
		kinds[loss.What] = loss.Why
	}
	if why, ok := kinds["attachment"]; !ok || !strings.Contains(why, "diagram.png") {
		t.Errorf("the attachment is not named in the report: %+v", report.Lost)
	}
	if _, ok := kinds["mentions"]; !ok {
		t.Errorf("the mention is not reported: %+v", report.Lost)
	}
	// And the sentence does not arrive with a hole in it.
	body, err := os.ReadFile(filepath.Join(wiki.WikiDir(reg), "eng", "with-attachment.md"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "Questions for .") {
		t.Errorf("the mention left a gap in the sentence:\n%s", body)
	}
}

// Permissions and version history are said out loud, because silence here reads
// as "nothing was lost".
func TestPermissionsAndVersionsAreReported(t *testing.T) {
	reg := confluenceProject(t, nil)
	src, far := newFakeConfluence(t)
	page := far.add("1", "Earlier Page", "", storagePlain)
	page.Version.Number = 7

	report, err := wiki.ImportWiki(context.Background(), reg, wiki.WikiDir(reg), src, "confluence:ENG")
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]string{}
	for _, loss := range report.Lost {
		kinds[loss.What] = loss.Why
	}
	if why, ok := kinds["versions"]; !ok || !strings.Contains(why, "7") {
		t.Errorf("the version history is not reported with its count: %+v", report.Lost)
	}
	if _, ok := kinds["permissions"]; !ok {
		t.Errorf("page restrictions are not reported: %+v", report.Lost)
	}
	// Comments are reported as NOT LOOKED AT rather than counted, because this
	// adapter does not fetch them and "0 comments" would be a measurement nobody
	// took.
	why, ok := kinds["comments"]
	if !ok {
		t.Errorf("comments are not mentioned at all: %+v", report.Lost)
	}
	if ok && !strings.Contains(why, "did not look") {
		t.Errorf("the comment entry claims to know a count it never fetched: %q", why)
	}
}

// The order of the two checks in mirrorOne, pinned.
//
// The remote check must come FIRST. It asks "did the far side change"; the local
// check asks "did this page change". A page edited only in Confluence has an
// unmoved local digest, so a run that asked the local question first would call
// it unchanged and never look at the far side — the conflict would be invisible
// and the next local edit would overwrite somebody's work without a word.
//
// The existing conflict test cannot catch this because it changes BOTH sides:
// reversed, the local check fails there too and the remote check still runs. The
// fixture that bites is exactly this one — only the far side moved.
func TestOnlyTheFarSideMovingIsStillAConflict(t *testing.T) {
	reg := confluenceProject(t, map[string]string{
		"handbook/first-day.md": "---\ntitle: First Day\n---\n\nText.\n",
	})
	src, far := newFakeConfluence(t)
	if _, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src); err != nil {
		t.Fatal(err)
	}

	// Somebody edits in Confluence. The wiki page is NOT touched, so its digest
	// still matches what was pushed.
	remote := far.byTitle(t, "First Day")
	remote.Version.Number++
	remote.Body.Storage.Value = "<p>Changed only remotely.</p>"

	report, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Conflicts) != 1 {
		t.Fatalf("a page changed only in Confluence what not reported as a conflict: %+v — "+
			"the local check ran first and called it unchanged, so the next local edit "+
			"would overwrite somebody's work silently", report)
	}
	if len(report.Unchanged) != 0 {
		t.Fatalf("the page what reported unchanged despite the far side moving: %+v", report)
	}
	if got := far.byTitle(t, "First Day").Body.Storage.Value; got != "<p>Changed only remotely.</p>" {
		t.Fatalf("the Confluence edit what overwritten: %q", got)
	}
}

// An import writes on a branch, never into the working tree.
//
// The failure this pins is not tidiness. An import is a mass write — 48 files at
// once is an ordinary size — and writing that into whatever is checked out
// destroys uncommitted work with no way back. the specification: "on a branch as a
// pull request like every other write; the import is reviewed before it is wiki
// content."
func TestAnImportWritesOnABranchNotTheWorkingTree(t *testing.T) {
	reg := gitWikiProject(t)

	// Uncommitted local work — the thing that has no way back.
	local := filepath.Join(wiki.WikiDir(reg), "onboarding", "first-day.md")
	if err := os.WriteFile(local, []byte(onboardingPage+"\nUNCOMMITTED CHANGE.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	session, err := wiki.OpenWikiBranch(reg, "wiki/import-eng")
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()

	src, far := newFakeConfluence(t)
	far.add("1", "First Day", "", storagePlain)
	far.add("2", "Second Day", "", storagePlain)

	report, err := wiki.ImportWiki(context.Background(), reg, session.WikiDir, src, "confluence:ENG")
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Pages) != 2 {
		t.Fatalf("imported %d pages: %+v", len(report.Pages), report.Pages)
	}

	// The uncommitted edit survives, untouched.
	after, err := os.ReadFile(local)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(after), "UNCOMMITTED CHANGE") {
		t.Fatal("the import destroyed uncommitted local work in the working tree")
	}
	// And nothing the import produced is in the working tree at all.
	if _, err := os.Stat(filepath.Join(wiki.WikiDir(reg), "eng")); err == nil {
		t.Fatal("the import wrote into the checked-out working tree")
	}
	// It is on the branch instead.
	if _, err := os.Stat(filepath.Join(session.WikiDir, "eng", "first-day.md")); err != nil {
		t.Fatalf("the import did not write onto the branch: %v", err)
	}

	// And it commits there, so the branch is a pull request somebody reviews.
	paths := make([]string, 0, len(report.Pages))
	for _, page := range report.Pages {
		paths = append(paths, page.Path)
	}
	commit, err := session.Commit("wiki: import confluence:ENG", paths)
	if err != nil {
		t.Fatal(err)
	}
	if len(commit.Files) != 2 {
		t.Fatalf("committed %v, want both imported pages", commit.Files)
	}
}

// Removing the unowned-title conflict check in Push must make this red.
func TestATitleAlreadyInTheSpaceIsNotAdopted(t *testing.T) {
	reg := confluenceProject(t, map[string]string{"handbook/voraussetzungen.md": "---\ntitle: Voraussetzungen\n---\n\nLocal content.\n"})
	src, far := newFakeConfluence(t)
	remote := far.add("unowned", "Voraussetzungen", "", "<p>Manually maintained.</p>")
	before := remote.Body.Storage.Value
	report, err := wiki.MirrorWiki(context.Background(), reg, wiki.WikiDir(reg), src)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Conflicts) != 1 || report.Conflicts[0].Page != "handbook/voraussetzungen.md" || !strings.Contains(report.Conflicts[0].Why, "did not create it") {
		t.Fatalf("unowned title must be reported as a conflict: %+v", report)
	}
	if far.created != 0 || len(report.Pushed) != 0 || remote.Body.Storage.Value != before || remote.Version.Number != 1 {
		t.Fatalf("the existing page what adopted or changed: created=%d report=%+v page=%+v", far.created, report, remote)
	}
}
