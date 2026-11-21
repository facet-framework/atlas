package main

import (
	"bytes"
	"testing"
)

func TestComposedVersionIdentifiesAllComponents(t *testing.T) {
	previousCore, previousAtlas, previousUI := version, atlasVersion, uiVersion
	t.Cleanup(func() { version, atlasVersion, uiVersion = previousCore, previousAtlas, previousUI })
	version, atlasVersion, uiVersion = "1.21.0-rc.4", "0.1.0-rc.4", "0.1.0-rc.4"
	command := newRootCmd()
	var output bytes.Buffer
	command.SetOut(&output)
	command.SetArgs([]string{"--version"})
	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}
	if got, want := output.String(), "facet 0.1.0-rc.4 (core 1.21.0-rc.4, facet-ui 0.1.0-rc.4)\n"; got != want {
		t.Fatalf("version = %q; want %q", got, want)
	}
}
