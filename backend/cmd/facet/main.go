package main

import (
	"os"
	"runtime"

	"github.com/facet-framework/atlas/backend/internal/bundledsums"
	"github.com/facet-framework/atlas/backend/internal/catalogue"
	"github.com/facet-framework/atlas/backend/server"
	"github.com/facet-framework/core/cli"
	"github.com/facet-framework/core/registry"
	"github.com/facet-framework/core/release"
	"github.com/spf13/cobra"
)

// version is set by the distribution's -ldflags -X main.version.
var version = "dev"

// Distribution identities are set only by the reviewed Atlas release build.
var atlasVersion, uiVersion string

// channel names the distribution channel a build was issued for, set only by
// a channel-specific release build through -ldflags -X main.channel=<channel>.
// Every other build leaves it empty, and an empty channel changes nothing.
var channel string

func main() {
	platform := runtime.GOOS + "-" + runtime.GOARCH
	for _, bin := range bundledsums.Bins {
		facet.SetBundledSidecarSum(bin, platform, bundledsums.Sum(bin, platform))
	}
	os.Exit(cli.Run(newRootCmd()))
}

func newRootCmd() *cobra.Command {
	identity := release.Current(version)
	identity.AtlasVersion = atlasVersion
	identity.UIVersion = uiVersion
	if channel != "" {
		identity.Channel = channel
	}
	command := cli.NewCommand(cli.Options{
		Identity:     &identity,
		Version:      version,
		ReaderAssets: server.BuiltAssets(),
		Commands:     append([]*cobra.Command{newUICmd()}, catalogue.Commands()...),
	})
	if template := versionTemplate(); template != "" {
		command.SetVersionTemplate(template)
	}
	return command
}

// versionTemplate composes the --version line from the identities a build was
// stamped with. Without composition or channel stamps it keeps Cobra's format;
// the product version can be explicit or a derived development identity.
func versionTemplate() string {
	composed := atlasVersion != "" && uiVersion != ""
	switch {
	case composed && channel != "":
		return "facet " + atlasVersion + " (core {{.Version}}, facet-ui " + uiVersion + ", " + channel + ")\n"
	case composed:
		return "facet " + atlasVersion + " (core {{.Version}}, facet-ui " + uiVersion + ")\n"
	case channel != "":
		return "facet {{.Version}} (" + channel + ")\n"
	}
	return ""
}
