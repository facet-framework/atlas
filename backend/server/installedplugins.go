package server

import (
	"errors"
	"net/http"
	"sort"

	"github.com/facet-framework/core/registry"
)

// InstalledPluginsPath is where the reader lists what it found under
// PluginsDir.
const InstalledPluginsPath = "/api/plugins"

// installedPlugin is one row of the /api/plugins answer.
type installedPlugin struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	API     int    `json:"api"`
	// Entry is a URL under PluginFilesPrefix, ready for import() as it
	// stands — never a bare path inside the package, which would mean
	// nothing to a browser.
	Entry string   `json:"entry"`
	Areas []string `json:"areas"`
	Slots []string `json:"slots"`

	Dev bool `json:"dev"`
	// Kind and Where come from .source.json unchanged, when it exists —
	// "local"/"url"/"github" and the path or address the install command
	// read the package from.
	Kind  string `json:"kind,omitempty"`
	Where string `json:"where,omitempty"`

	Verification string `json:"verification"`
}

// installedPlugins answers what this reader found under PluginsDir.
func (s *Server) installedPlugins(w http.ResponseWriter, r *http.Request) {
	if !allowLocalRead(w, r, "list installed plugins") {
		return
	}

	plugins := []installedPlugin{}
	if s.PluginsDir != "" {
		found, err := facet.InstalledPlugins(s.PluginsDir)
		if err == nil {
			for _, ip := range found {
				plugins = append(plugins, toInstalledPluginRow(ip))
			}
		}
	}
	sort.Slice(plugins, func(i, j int) bool { return plugins[i].ID < plugins[j].ID })

	writeJSON(w, struct {
		Plugins []installedPlugin `json:"plugins"`
	}{Plugins: plugins})
}

// toInstalledPluginRow turns one facet.InstalledPlugin into the JSON shape
// this route has always answered. facet.InstalledPlugin's State is a single
// human-readable string ("ok", or "invalid: <reason>") meant for a
// terminal — the four-value enum the TypeScript side switches on
// ("ok"/"checksum-mismatch"/"api-unsupported"/"invalid") is reconstructed
// here from the same VerifyError the state string was built from, rather
// than by parsing that string back apart.
func toInstalledPluginRow(ip facet.InstalledPlugin) installedPlugin {
	m := ip.Manifest
	entry := ""
	if m.Entry != "" {
		entry = PluginFilesPrefix + ip.ID + "/" + m.Entry
	}

	return installedPlugin{
		ID:           m.ID,
		Name:         m.Name,
		Version:      m.Version,
		API:          m.API,
		Entry:        entry,
		Areas:        orEmpty(m.Areas),
		Slots:        orEmpty(m.Slots),
		Dev:          ip.Source.Dev,
		Kind:         string(ip.Source.Kind),
		Where:        ip.Source.Where,
		Verification: verificationOf(ip),
	}
}

// @facet: customization/plugins/plugin-package-verification
// @facet-role: primary
// verificationOf narrows facet.InstalledPlugin's free-text VerifyError into
// the one of four states the management page distinguishes.
// facet.VerifyPackage names each rule's own failure with a sentinel error
// (ErrPluginAPIMismatch, ErrPluginChecksumMismatch); everything else this
// package has no more specific label for — a malformed manifest, an
// out-of-allow-list file, a bundled-id collision — falls to "invalid".
func verificationOf(ip facet.InstalledPlugin) string {
	switch {
	case ip.VerifyError == nil:
		return "ok"
	case errors.Is(ip.VerifyError, facet.ErrPluginAPIMismatch):
		return "api-unsupported"
	case errors.Is(ip.VerifyError, facet.ErrPluginChecksumMismatch):
		return "checksum-mismatch"
	default:
		return "invalid"
	}
}

// orEmpty turns a nil slice into an empty one — nil and empty serialise
// differently to JSON ("null" vs "[]"), and a plugin that declares no areas
// is a fact the surface should read as "none", not "unmeasured".
func orEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
