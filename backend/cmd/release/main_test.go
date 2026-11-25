package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReleaseVersion(t *testing.T) {
	for _, tc := range []struct {
		source, request string
		valid           bool
	}{
		{"1.2.3", "1.2.3", true},
		{"1.2.3-rc.1", "1.2.3-rc.1", true},
		{"1.2.3-rc.1", "1.2.3", false},
		{"1.2.3-rc.0", "1.2.3-rc.0", false},
		{"../escape", "../escape", false},
	} {
		t.Run(tc.source+"/"+tc.request, func(t *testing.T) {
			writeReleaseSource(t, tc.source)
			ui, err := releaseVersion(tc.request)
			if (err == nil) != tc.valid || tc.valid && ui != "0.1.0-rc.2" {
				t.Fatalf("releaseVersion(%q) = %q, %v", tc.request, ui, err)
			}
		})
	}
}

func TestReadStableArtifact(t *testing.T) {
	dir := t.TempDir()
	entry := artifact{Platform: "linux_amd64", Archive: "facet-atlas_1.2.3_linux_amd64.tar.gz"}
	archive := filepath.Join(dir, entry.Archive)
	if err := os.WriteFile(archive, []byte("archive contents"), 0644); err != nil {
		t.Fatal(err)
	}
	sum, err := digest(archive)
	if err != nil {
		t.Fatal(err)
	}
	entry.SHA256 = sum
	if err := writeMetadata(dir, manifest{ManifestVersion: 1, Version: "1.2.3", Channel: "stable", Platforms: []artifact{entry}}); err != nil {
		t.Fatal(err)
	}
	info, got, err := readArtifact(dir)
	if err != nil || info.ManifestVersion != 1 || info.Version != "1.2.3" || info.Channel != "stable" || got.Archive != entry.Archive || got.Size != int64(len("archive contents")) {
		t.Fatalf("readArtifact() = %+v, %+v, %v", info, got, err)
	}
}

func TestUnknownPlatform(t *testing.T) {
	writeReleaseSource(t, "1.2.3-rc.1")
	err := packageRelease("1.2.3-rc.1", "linux_unknown", "out")
	if err == nil || !strings.Contains(err.Error(), "unsupported platform") {
		t.Fatalf("expected unsupported platform, got %v", err)
	}
}

func TestReleaseRequiresCleanCheckoutAndEmbeddedAssets(t *testing.T) {
	writeReleaseSource(t, "1.2.3")
	if _, err := output(nil, "git", "init", "-q", "--initial-branch=fixture"); err != nil {
		t.Fatal(err)
	}
	check := func(reason string) {
		t.Helper()
		err := packageRelease("1.2.3", "linux_amd64", "out")
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

func writeReleaseSource(t *testing.T, version string) {
	t.Helper()
	t.Chdir(t.TempDir())
	if err := os.Mkdir("frontend", 0755); err != nil {
		t.Fatal(err)
	}
	source := fmt.Sprintf(`{"version":%q,"dependencies":{"@facet-tools/ui":"0.1.0-rc.2"}}`, version)
	if err := os.WriteFile("frontend/package.json", []byte(source), 0644); err != nil {
		t.Fatal(err)
	}
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
