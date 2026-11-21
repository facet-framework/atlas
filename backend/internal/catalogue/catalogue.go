// Package catalogue registers the plugins that Atlas supplies to FACET Core.
package catalogue

import (
	"encoding/json"

	"github.com/facet-framework/atlas/backend/server"
	"github.com/facet-framework/atlas/plugins/dmn"
	"github.com/facet-framework/atlas/plugins/wiki"
	"github.com/facet-framework/atlas/plugins/wiki/wikicli"
	"github.com/facet-framework/core/registry"
	"github.com/spf13/cobra"
)

func init() {
	facet.RegisterBundledPlugin(dmn.Manifest())
	facet.RegisterBundledPlugin(wiki.Manifest())
	wiki.RegisterCorpus()
}

func Configure(server *server.Server) {
	plugin := wiki.NewService(server.Registry, server.PluginBroker())
	server.PluginTools = map[string]map[string]func(json.RawMessage) (any, error){"wiki": plugin.Tools()}
	server.PluginRoutes = plugin.Routes()
	server.PluginClose = plugin.Close
}

func Commands() []*cobra.Command {
	return []*cobra.Command{wikicli.NewCommand()}
}
