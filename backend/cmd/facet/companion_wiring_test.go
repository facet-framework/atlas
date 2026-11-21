package main

import (
	"github.com/facet-framework/core/cli"
	"path/filepath"
	"testing"
)

// The companion the shipped binary builds knows where plugins live.
func TestTheCompanionTheBinaryBuildsKnowsWhereItsPluginsAre(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "plugins")
	t.Setenv("FACET_PLUGINS_DIR", dir)

	companion := newCompanion(t.TempDir(), "", "")

	if companion.PluginsDir != dir {
		t.Errorf("PluginsDir = %q, want %q: a plugin tool the reader granted "+
			"cannot reach the agent unless the companion knows this directory",
			companion.PluginsDir, dir)
	}
}

// And it is the same directory the reader's own plugin calls resolve against.
func TestTheCompanionAndTheServerLookInTheSamePlace(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "plugins")
	t.Setenv("FACET_PLUGINS_DIR", dir)

	if got := newCompanion(t.TempDir(), "", "").PluginsDir; got != cli.PluginsDir() {
		t.Errorf("the companion looks in %q and the server in %q", got, cli.PluginsDir())
	}
}
