package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/facet-framework/core/registry"
)

func repoGit(t *testing.T, root string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.test", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.test")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestRepoStateReadsCheckoutWithoutAPlugin(t *testing.T) {
	root := t.TempDir()
	if out, err := exec.Command("git", "-C", root, "init", "-q", "-b", "fixture").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}
	s := &Server{Registry: facet.Registry{Root: root}}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, loopbackRequest(http.MethodGet, RepoStatePath, nil))
	var got struct {
		Repository bool
		Branch     string
		Dirty      bool
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || !got.Repository || got.Branch != "fixture" || got.Dirty {
		t.Fatalf("unexpected state (%d): %s", rec.Code, rec.Body.String())
	}
}

func TestRepoStateWithoutCheckoutAndWithForeignOrigin(t *testing.T) {
	s := &Server{Registry: facet.Registry{Root: t.TempDir()}}
	rec := httptest.NewRecorder()
	req := loopbackRequest(http.MethodGet, RepoStatePath, nil)
	s.Handler().ServeHTTP(rec, req)
	var got struct {
		Repository bool
		Dirty      bool
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || got.Repository || got.Dirty {
		t.Fatalf("unexpected state: %s", rec.Body.String())
	}
	req.Header.Set("Origin", "https://example.com")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign origin: %d", rec.Code)
	}
}

func TestRepoStateReadsRegistryNameCommitAndRelativeUnicodeHistory(t *testing.T) {
	root := t.TempDir()
	repoGit(t, root, "init", "-q", "-b", "fixture")
	registryRoot := filepath.Join(root, "product")
	if err := os.MkdirAll(filepath.Join(registryRoot, "docs", "facets"), 0755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(registryRoot, "docs", "facets", "résumé.yaml")
	if err := os.WriteFile(file, []byte("name: Atlas\n"), 0644); err != nil {
		t.Fatal(err)
	}
	repoGit(t, root, "add", ".")
	repoGit(t, root, "commit", "-q", "-m", "add unicode record")
	wantCommit := repoGit(t, root, "rev-parse", "HEAD")
	s := &Server{Registry: facet.Registry{Root: registryRoot, Name: "Atlas Registry"}}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, loopbackRequest(http.MethodGet, RepoStatePath, nil))
	var got repoStateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Name != "Atlas Registry" || got.Commit != wantCommit || got.Branch != "fixture" {
		t.Fatalf("identity fields: %+v", got)
	}
	if got.HistoryWindow != repoHistoryWindow || got.HistoryExhausted || got.Shallow {
		t.Fatalf("history bounds: %+v", got)
	}
	if len(got.History) != 1 || len(got.History[0].Files) != 1 || got.History[0].Files[0] != "docs/facets/résumé.yaml" {
		t.Fatalf("relative unicode history: %+v", got.History)
	}
}

func TestRepoStateReportsShallowClone(t *testing.T) {
	source := t.TempDir()
	repoGit(t, source, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(source, "record.yaml"), []byte("one\n"), 0644); err != nil {
		t.Fatal(err)
	}
	repoGit(t, source, "add", ".")
	repoGit(t, source, "commit", "-q", "-m", "first")
	clone := filepath.Join(t.TempDir(), "clone")
	cmd := exec.Command("git", "clone", "-q", "--depth=1", "file://"+source, clone)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("shallow clone: %v: %s", err, out)
	}
	s := &Server{Registry: facet.Registry{Root: clone}}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, loopbackRequest(http.MethodGet, RepoStatePath, nil))
	var got repoStateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Repository || !got.Shallow || len(got.History) != 1 {
		t.Fatalf("shallow state: %+v", got)
	}
}

func TestRepoStateCapsFilesInACommit(t *testing.T) {
	root := t.TempDir()
	repoGit(t, root, "init", "-q", "-b", "main")
	for i := 0; i <= repoHistoryFiles; i++ {
		name := filepath.Join(root, "records", fmt.Sprintf("record-%03d.yaml", i))
		if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte("record\n"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	repoGit(t, root, "add", ".")
	repoGit(t, root, "commit", "-q", "-m", "many records")
	s := &Server{Registry: facet.Registry{Root: root}}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, loopbackRequest(http.MethodGet, RepoStatePath, nil))
	var got repoStateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.HistoryTruncated || len(got.History) != 1 || !got.History[0].Truncated || len(got.History[0].Files) != repoHistoryFiles {
		t.Fatalf("file cap: %+v", got)
	}
}

func TestRepoStateReportsAnExhaustedHistoryWindow(t *testing.T) {
	root := t.TempDir()
	repoGit(t, root, "init", "-q", "-b", "main")
	for i := 0; i < repoHistoryWindow; i++ {
		if err := os.WriteFile(filepath.Join(root, "record.yaml"), []byte(fmt.Sprintf("revision: %d\n", i)), 0644); err != nil {
			t.Fatal(err)
		}
		repoGit(t, root, "add", "record.yaml")
		repoGit(t, root, "commit", "-q", "-m", fmt.Sprintf("commit %02d", i))
	}
	s := &Server{Registry: facet.Registry{Root: root}}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, loopbackRequest(http.MethodGet, RepoStatePath, nil))
	var got repoStateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.HistoryWindow != repoHistoryWindow || !got.HistoryExhausted || len(got.History) != repoHistoryWindow {
		t.Fatalf("history window: %+v", got)
	}
}

func TestUnknownAPIRouteIsNotASPADocument(t *testing.T) {
	s := &Server{Registry: facet.Registry{Root: t.TempDir()}}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, loopbackRequest(http.MethodGet, "/api/removed", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown API status = %d", rec.Code)
	}
}
