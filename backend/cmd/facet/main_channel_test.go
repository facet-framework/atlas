package main

import (
	"bytes"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func versionLine(t *testing.T) string {
	t.Helper()
	command := newRootCmd()
	var output bytes.Buffer
	command.SetOut(&output)
	command.SetArgs([]string{"--version"})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	return output.String()
}

func stampBuild(t *testing.T, core, atlas, ui, issued string) {
	t.Helper()
	previousCore, previousAtlas, previousUI, previousChannel := version, atlasVersion, uiVersion, channel
	t.Cleanup(func() {
		version, atlasVersion, uiVersion, channel = previousCore, previousAtlas, previousUI, previousChannel
	})
	version, atlasVersion, uiVersion, channel = core, atlas, ui, issued
}

func TestAStampedChannelAppearsInTheVersionLine(t *testing.T) {
	stampBuild(t, "1.21.0-rc.2", "", "", "ea-acme")
	if got, want := versionLine(t), "facet 1.21.0-rc.2 (ea-acme)\n"; got != want {
		t.Fatalf("version = %q; want %q", got, want)
	}
}

func TestAnUnstampedBuildPrintsTheVersionAsBefore(t *testing.T) {
	stampBuild(t, "1.21.0-rc.2", "", "", "")
	if got, want := versionLine(t), "facet version 1.21.0-rc.2\n"; got != want {
		t.Fatalf("version = %q; want %q", got, want)
	}
}

func TestTheComposedIdentityKeepsTheChannel(t *testing.T) {
	stampBuild(t, "1.21.0-rc.4", "0.1.0-rc.4", "0.1.0-rc.4", "ea-acme")
	if got, want := versionLine(t), "facet 0.1.0-rc.4 (core 1.21.0-rc.4, facet-ui 0.1.0-rc.4, ea-acme)\n"; got != want {
		t.Fatalf("version = %q; want %q", got, want)
	}
}

// The publisher stamps the channel with -ldflags on a real `go build`; a unit
// test over the package variable cannot see whether that flag reaches this
// package. Build the binary the way the publisher does and read its answer.
func TestTheChannelLdflagReachesTheBuiltBinary(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the facet binary")
	}
	goTool, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go toolchain not on PATH")
	}
	cases := []struct{ ldflags, want string }{
		{"-X main.version=1.21.0-rc.2 -X main.channel=ea-acme", "facet 1.21.0-rc.2 (ea-acme)\n"},
		{"-X main.version=1.21.0-rc.2", "facet version 1.21.0-rc.2\n"},
	}
	for index, tc := range cases {
		binary := filepath.Join(t.TempDir(), "facet")
		if runtime.GOOS == "windows" {
			binary += ".exe"
		}
		build := exec.Command(goTool, "build", "-buildvcs=false", "-ldflags", tc.ldflags, "-o", binary, ".")
		if out, err := build.CombinedOutput(); err != nil {
			t.Fatalf("case %d: go build: %v\n%s", index, err, out)
		}
		out, err := exec.Command(binary, "--version").Output()
		if err != nil {
			t.Fatalf("case %d: --version: %v", index, err)
		}
		if got := string(out); got != tc.want {
			t.Fatalf("case %d: built binary printed %q; want %q", index, strings.TrimSpace(got), tc.want)
		}
	}
}
