// Package dmn exposes the manifest for the bundled DMN plugin.
package dmn

import (
	_ "embed"
	"encoding/json"

	"github.com/facet-framework/core/registry"
)

//go:embed plugin.json
var manifest []byte

func Manifest() facet.PluginManifest {
	var result facet.PluginManifest
	if err := json.Unmarshal(manifest, &result); err != nil {
		panic(err)
	}
	return result
}
