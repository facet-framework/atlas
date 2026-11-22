package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCandidate(t *testing.T) {
	t.Chdir(filepath.Join("..", "..", ".."))
	if ui, err := candidate("0.1.0-rc.1"); err != nil || ui != "0.1.0-rc.2" {
		t.Fatalf("candidate = %q, %v", ui, err)
	}
	for _, version := range []string{"0.1.0", "0.1.0-rc.2", "../escape", "0.1.0-rc.1; echo bad"} {
		if _, err := candidate(version); err == nil {
			t.Errorf("accepted %q", version)
		}
	}
}

func TestUnknownPlatform(t *testing.T) {
	t.Chdir(filepath.Join("..", "..", ".."))
	err := packageRelease("0.1.0-rc.1", "linux_unknown", filepath.Join(t.TempDir(), "out"))
	if err == nil || !strings.Contains(err.Error(), "unsupported platform") {
		t.Fatalf("expected unsupported platform, got %v", err)
	}
}

func TestReleaseRequiresCleanCheckoutAndEmbeddedAssets(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "frontend", "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Chdir(t.TempDir())
	if _, err := output(nil, "git", "init", "-q", "--initial-branch=fixture"); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir("frontend", 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("frontend/package.json", source, 0644); err != nil {
		t.Fatal(err)
	}
	check := func(reason string) {
		t.Helper()
		err := packageRelease("0.1.0-rc.1", "linux_amd64", "out")
		if err == nil || !strings.Contains(err.Error(), reason) {
			t.Fatalf("expected %q, got %v", reason, err)
		}
		if _, err := os.Stat("out"); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("output changed after rejection: %v", err)
		}
	}
	check("clean checkout")
	if _, err := output(nil, "git", "add", "frontend/package.json"); err != nil {
		t.Fatal(err)
	}
	if _, err := output(nil, "git", "-c", "user.name=Atlas", "-c", "user.email=atlas@example.invalid", "commit", "-qm", "Add release fixture"); err != nil {
		t.Fatal(err)
	}
	check("missing embedded browser asset")
}

func TestOutputKeepsDiagnosticsOutOfTheResult(t *testing.T) {
	got, err := output(nil, "sh", "-c", "echo 'go: downloading example.com/module v1.0.0' >&2; echo 'example.com/module v1.0.0'")
	if err != nil {
		t.Fatal(err)
	}
	if got != "example.com/module v1.0.0" {
		t.Fatalf("output = %q, want only standard output", got)
	}
	_, err = output(nil, "sh", "-c", "echo 'go: module not found' >&2; exit 3")
	if err == nil || !strings.Contains(err.Error(), "go: module not found") {
		t.Fatalf("error = %v, want the standard error text", err)
	}
}
