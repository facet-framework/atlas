package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/facet-framework/core/registry"
)

// reportRepo makes a real git repository with one commit and returns the root
// and the commit the report must name to be fresh.
func reportRepo(t *testing.T) (facet.Registry, string) {
	t.Helper()
	root := t.TempDir()
	for _, args := range [][]string{
		{"init", "-q"},
		{"config", "user.email", "hello@facet-framework.com"},
		{"config", "user.name", "Test"},
	} {
		if out, err := exec.Command("git", append([]string{"-C", root}, args...)...).CombinedOutput(); err != nil {
			t.Skipf("git unavailable: %v %s", err, out)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "-A"}, {"commit", "-q", "-m", "first"}} {
		if out, err := exec.Command("git", append([]string{"-C", root}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	head, _, err := facet.GitTreeState(root)
	if err != nil {
		t.Fatal(err)
	}
	return facet.Registry{Root: root}, head
}

// reportJSON renders one registry entry the way `facet test --json` does:
// one file passed, `failed` files failed.
func reportJSON(head string, dirty bool, failed int) string {
	files := `"tests/ok_test.go":"passed"`
	feature := `"tests/ok_test.go":"passed"`
	list := `"tests/ok_test.go"`
	for i := 0; i < failed; i++ {
		name := fmt.Sprintf("tests/bad%d_test.go", i)
		files += fmt.Sprintf(`,%q:"failed"`, name)
		list += fmt.Sprintf(`,%q`, name)
	}
	_ = feature
	headField := ""
	if head != "" {
		headField = fmt.Sprintf(`"head":%q,"dirty":%t,`, head, dirty)
	}
	return fmt.Sprintf(`[{%s"discovery":{"runners":[{"name":"go","measured":true,"files":[%s]}],"findings":[]},"runners":[{"name":"go","exit_code":0,"files":{%s}}],"features":[]}]`, headField, list, files)
}

func askReport(t *testing.T, s *Server) testReportResponse {
	t.Helper()
	req := loopbackRequest(http.MethodGet, TestReportPath, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var body testReportResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unreadable response %q: %v", rec.Body.String(), err)
	}
	// The response itself must not carry a count unless it is fresh: checked on
	// the wire, not on the decoded struct.
	if body.State != testReportFresh {
		for _, key := range []string{`"passed":`, `"failed":`, `"unmeasured":`} {
			if strings.Contains(rec.Body.String(), key) {
				t.Fatalf("state %q leaked a count: %s", body.State, rec.Body.String())
			}
		}
	}
	return body
}

func writeReport(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "report.json")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// Named mutation: in testReportState, drop the `entry.Head != head` case so a
// report from another commit is counted - the stale case turns red.
func TestOnlyAFreshReportCarriesNumbers(t *testing.T) {
	reg, head := reportRepo(t)

	fresh := askReport(t, &Server{Registry: reg, TestReport: writeReport(t, reportJSON(head, false, 2))})
	if fresh.State != testReportFresh || fresh.Failed == nil || *fresh.Failed != 2 || *fresh.Passed != 1 {
		t.Fatalf("a fresh report must carry its measured counts: %+v", fresh)
	}

	zero := askReport(t, &Server{Registry: reg, TestReport: writeReport(t, reportJSON(head, false, 0))})
	if zero.State != testReportFresh || zero.Failed == nil || *zero.Failed != 0 {
		t.Fatalf("a measured zero must stay a zero: %+v", zero)
	}

	stale := askReport(t, &Server{Registry: reg, TestReport: writeReport(t, reportJSON(strings.Repeat("a", 40), false, 2))})
	if stale.State != testReportStale || stale.Failed != nil || stale.Passed != nil {
		t.Fatalf("a report from another commit must be stale and carry no count: %+v", stale)
	}

	dirty := askReport(t, &Server{Registry: reg, TestReport: writeReport(t, reportJSON(head, true, 2))})
	if dirty.State != testReportDirty || dirty.Failed != nil {
		t.Fatalf("a report from a dirty tree must carry no count: %+v", dirty)
	}
}

// Mutation: execute a configured runner/list command while serving the report
// -> the sentinel appears. The helper is actually run once as a positive control.
func TestReadingAReportNeverRunsConfiguredTests(t *testing.T) {
	reg, _ := reportRepo(t)
	marker := filepath.Join(t.TempDir(), "runner-ran")
	helper := filepath.Join(reg.Root, "runner.sh")
	if err := os.WriteFile(helper, []byte("#!/bin/sh\nprintf ran > "+strconv.Quote(marker)+"\nprintf '[\"sentinel_test.go\"]\\n'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	command := "sh " + strconv.Quote(helper)
	config := "runners:\n  go:\n    command: " + strconv.Quote(command) + "\n    list: " + strconv.Quote(command) + "\n    list_format: json\n    report: go-json\n    report_file: runner.json\n"
	if err := os.WriteFile(filepath.Join(reg.Root, ".facetrc.yaml"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, err := facet.LoadConfig(reg.Root)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Runners["go"].Command != command || cfg.Runners["go"].List != command {
		t.Fatalf("real config did not load sentinel: %+v", cfg.Runners)
	}
	reg = cfg.All()[0]
	if err := os.MkdirAll(filepath.Join(reg.RecordsDir, "features"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(reg.Root, "sentinel_test.go"), []byte("package sentinel\nimport \"testing\"\nfunc TestSentinel(t *testing.T) {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	discovery, err := facet.CheckTests(context.Background(), cfg, reg, "go", false)
	if err != nil || len(discovery.Runners) != 1 || !discovery.Runners[0].Measured {
		t.Fatalf("configured runner was not measured: %+v %v", discovery, err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "-A"}, {"commit", "-q", "-m", "configured runner"}} {
		if out, err := exec.Command("git", append([]string{"-C", reg.Root}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git: %v %s", err, out)
		}
	}
	head, _, err := facet.GitTreeState(reg.Root)
	if err != nil {
		t.Fatal(err)
	}
	body := reportJSON(head, false, 2)
	file := writeReport(t, body)
	s := &Server{Registry: reg, TestReport: file}
	for i := 0; i < 2; i++ {
		if got := askReport(t, s); got.State != testReportFresh || got.Failed == nil || *got.Failed != 2 {
			t.Fatalf("report not read: %+v", got)
		}
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("reader executed configured test command: %v", err)
	}
	if after, err := os.ReadFile(file); err != nil || string(after) != body {
		t.Fatalf("reader changed report: %v", err)
	}
}

// A new commit makes yesterday's fresh report stale: the same file, judged
// again on the next request.
func TestAReportGoesStaleWhenTheRepositoryMovesOn(t *testing.T) {
	reg, head := reportRepo(t)
	s := &Server{Registry: reg, TestReport: writeReport(t, reportJSON(head, false, 1))}
	if got := askReport(t, s); got.State != testReportFresh {
		t.Fatalf("precondition: the report must be fresh before the commit: %+v", got)
	}
	if err := os.WriteFile(filepath.Join(reg.Root, "b.txt"), []byte("b"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "-A"}, {"commit", "-q", "-m", "second"}} {
		if out, err := exec.Command("git", append([]string{"-C", reg.Root}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	if got := askReport(t, s); got.State != testReportStale || got.Failed != nil {
		t.Fatalf("after a new commit the report must be stale: %+v", got)
	}
}

func TestNoUsableReportIsNeverANumber(t *testing.T) {
	reg, head := reportRepo(t)
	dir := t.TempDir()
	big := filepath.Join(dir, "big.json")
	if err := os.WriteFile(big, []byte("["+strings.Repeat(" ", maxTestReportBytes+1)+"]"), 0o644); err != nil {
		t.Fatal(err)
	}
	cases := map[string]struct {
		path string
		want string
	}{
		"no flag":               {"", testReportNone},
		"file is missing":       {filepath.Join(dir, "missing.json"), testReportNone},
		"malformed":             {writeReport(t, `{not json`), testReportUnreadable},
		"wrong shape":           {writeReport(t, `{"failed": 0}`), testReportUnreadable},
		"a directory":           {dir, testReportUnreadable},
		"over the size cap":     {big, testReportUnreadable},
		"empty list":            {writeReport(t, `[]`), testReportNoEntry},
		"no head in the report": {writeReport(t, reportJSON("", false, 3)), testReportNoHead},
		"another registry":      {writeReport(t, strings.Replace(reportJSON(head, false, 3), `"discovery":{`, `"discovery":{"registry":"other",`, 1)), testReportNoEntry},
		"nothing measured":      {writeReport(t, strings.Replace(reportJSON(head, false, 0), `"files":{"tests/ok_test.go":"passed"}`, `"files":{}`, 1)), testReportUnmeasured},
	}
	for name, c := range cases {
		got := askReport(t, &Server{Registry: reg, TestReport: c.path})
		if got.State != c.want || got.Failed != nil {
			t.Errorf("%s: want state %q without a count, got %+v", name, c.want, got)
		}
	}
}

func TestAReportOutsideAGitRepositoryCannotBeJudged(t *testing.T) {
	root := t.TempDir()
	if out, err := exec.Command("git", "-C", root, "rev-parse", "--git-dir").CombinedOutput(); err == nil {
		t.Skipf("the temp dir is inside a repository: %s", out)
	}
	got := askReport(t, &Server{Registry: facet.Registry{Root: root}, TestReport: writeReport(t, reportJSON(strings.Repeat("a", 40), false, 1))})
	if got.State != testReportNoGit || got.Failed != nil {
		t.Fatalf("without a readable HEAD no report is fresh: %+v", got)
	}
}

func TestTheReportRouteRefusesAForeignOrigin(t *testing.T) {
	req := loopbackRequest(http.MethodGet, TestReportPath, nil)
	req.Header.Set("Origin", "https://example.com")
	rec := httptest.NewRecorder()
	(&Server{}).Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
}

func gitRun(t *testing.T, root string, args ...string) {
	t.Helper()
	if out, err := exec.Command("git", append([]string{"-C", root}, args...)...).CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
}

// Named mutation: in testReportState read `head, _, err := GitTreeState(...)`
// so the current tree's dirty flag is dropped; every case below turns red.
func TestACleanReportIsNotFreshBesideAChangedTree(t *testing.T) {
	reg, head := reportRepo(t)
	s := &Server{Registry: reg, TestReport: writeReport(t, reportJSON(head, false, 1))}
	if got := askReport(t, s); got.State != testReportFresh {
		t.Fatalf("precondition: the report must be fresh on a clean tree: %+v", got)
	}
	changes := map[string]func(){
		"a tracked file edited": func() {
			f, _ := os.OpenFile(filepath.Join(reg.Root, "a.txt"), os.O_APPEND|os.O_WRONLY, 0o644)
			f.WriteString("more")
			f.Close()
		},
		"an untracked file": func() { os.WriteFile(filepath.Join(reg.Root, "new.txt"), []byte("n"), 0o644) },
		"a staged change": func() {
			os.WriteFile(filepath.Join(reg.Root, "staged.txt"), []byte("s"), 0o644)
			gitRun(t, reg.Root, "add", "staged.txt")
		},
	}
	for name, change := range changes {
		gitRun(t, reg.Root, "reset", "-q", "--hard")
		gitRun(t, reg.Root, "clean", "-fdq")
		change()
		got := askReport(t, s)
		if got.State != testReportTreeChanged || got.Failed != nil {
			t.Errorf("%s: want %q without a count, got %+v", name, testReportTreeChanged, got)
		}
	}
}

// Named mutations: compare the head by prefix (`strings.HasPrefix(head,
// entry.Head)`), treat a missing dirty as clean, or swap the stale and dirty
// cases - one case each turns red.
func TestTheJudgementIsExactAndOrdered(t *testing.T) {
	reg, head := reportRepo(t)
	other := strings.Repeat("a", 40)
	cases := map[string]struct{ json, want string }{
		"a head prefix is not the head": {strings.Replace(reportJSON(head, false, 1), head, head[:7], 1), testReportStale},
		"a missing dirty is unknown":    {strings.Replace(reportJSON(head, false, 1), `"dirty":false,`, "", 1), testReportNoHead},
		"stale beats dirty":             {reportJSON(other, true, 1), testReportStale},
	}
	for name, c := range cases {
		got := askReport(t, &Server{Registry: reg, TestReport: writeReport(t, c.json)})
		if got.State != c.want || got.Failed != nil {
			t.Errorf("%s: want %q, got %+v", name, c.want, got)
		}
	}
}

// Named mutations: drop the duplicate-key scan, the duplicate-registry check
// or the duplicate-runner check - the matching case turns red.
func TestAmbiguousReportsAreRefusedNotResolved(t *testing.T) {
	reg, head := reportRepo(t)
	one := reportJSON(head, false, 1)
	dirtyTwice := strings.Replace(one, `"dirty":false,`, `"dirty":true,"dirty":false,`, 1)
	entry := strings.TrimSuffix(strings.TrimPrefix(one, "["), "]")
	dirtyEntry := strings.Replace(entry, `"dirty":false`, `"dirty":true`, 1)
	failedThenPassed := fmt.Sprintf(`[{"head":%q,"dirty":false,"discovery":{"runners":[{"name":"go","measured":true,"files":["tests/x_test.go"]}],"findings":[]},"runners":[{"name":"go","exit_code":1,"files":{"tests/x_test.go":"failed"}},{"name":"go","exit_code":0,"files":{"tests/x_test.go":"passed"}}],"features":[]}]`, head)
	cases := map[string]string{
		"a key twice":                  dirtyTwice,
		"two entries, clean first":     "[" + entry + "," + dirtyEntry + "]",
		"two entries, dirty first":     "[" + dirtyEntry + "," + entry + "]",
		"two runners of the same name": failedThenPassed,
	}
	for name, content := range cases {
		got := askReport(t, &Server{Registry: reg, TestReport: writeReport(t, content)})
		if got.State != testReportAmbiguous || got.Failed != nil {
			t.Errorf("%s: want %q without a count, got %+v", name, testReportAmbiguous, got)
		}
	}
}

// Named mutation: put `Detail: err.Error()` back into the unreadable response;
// the path and the file's first bytes reach the browser and this turns red.
func TestUnreadableReportsSendReasonCodesNotErrors(t *testing.T) {
	reg, _ := reportRepo(t)
	dir := t.TempDir()
	secret := filepath.Join(dir, "secret.txt")
	os.WriteFile(secret, []byte("root:x:0:0:SECRETCONTENT"), 0o644)
	link := filepath.Join(dir, "link.json")
	if err := os.Symlink(secret, link); err != nil {
		t.Skip(err)
	}
	locked := filepath.Join(dir, "locked.json")
	os.WriteFile(locked, []byte("[]"), 0o000)
	cases := map[string]struct{ path, reason string }{
		"malformed":              {writeReport(t, `{not json`), reasonNotJSON},
		"wrong type":             {writeReport(t, `[{"dirty":"yes"}]`), reasonWrongShape},
		"symlink to a text file": {link, reasonNotJSON},
		"a directory":            {dir, reasonNotRegular},
	}
	if os.Getuid() != 0 {
		cases["permission"] = struct{ path, reason string }{locked, reasonPermission}
	}
	for name, c := range cases {
		req := loopbackRequest(http.MethodGet, TestReportPath, nil)
		rec := httptest.NewRecorder()
		(&Server{Registry: reg, TestReport: c.path}).Handler().ServeHTTP(rec, req)
		body := rec.Body.String()
		var got testReportResponse
		json.Unmarshal(rec.Body.Bytes(), &got)
		if got.State != testReportUnreadable || got.Reason != c.reason {
			t.Errorf("%s: want unreadable/%s, got %s", name, c.reason, body)
		}
		for _, leak := range []string{dir, "SECRETCONTENT", "invalid character", "struct field", "permission denied", "/tmp"} {
			if strings.Contains(body, leak) {
				t.Errorf("%s: the response leaks %q: %s", name, leak, body)
			}
		}
	}
}
