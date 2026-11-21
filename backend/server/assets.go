package server

import (
	"embed"
	"io/fs"
)

// Build the frontend before compiling a release binary.
//
//go:generate sh ../../scripts/build-reader.sh

// builtFS holds the built reader. Only backend/server/assets/.gitkeep is tracked,
// so the pattern matches on a checkout that never built the reader and the
// package still compiles.
//
// The 'all:' prefix includes the dot file and any asset beginning with a dot or
// underscore.
//
//go:embed all:assets
var builtFS embed.FS

// placeholderFS is the one page served when builtFS holds no reader. It exists
// so that 'go build', 'go vet' and 'go test' work for someone who only touches
// Go and has no Node toolchain; the alternative, a compile error, would put the
// whole UI toolchain in front of every Go change. The page says how to build
// the reader, so the missing bundle is named rather than shown as a blank tab.
//
//go:embed placeholder
var placeholderFS embed.FS

// Assets returns what the reader serves, rooted at its index page: the built
// reader, or the placeholder page when this binary was compiled without one.
func Assets() fs.FS {
	if ReaderBuilt() {
		return BuiltAssets()
	}
	return rooted(placeholderFS, "placeholder")
}

// BuiltAssets returns only what the build embedded from backend/server/assets,
// never the placeholder. It has no index page when the reader was not built,
// which is what 'facet setup status' must report as it is: a placeholder page
// is not a reader, and a status row that stat'ed it would call it embedded.
func BuiltAssets() fs.FS {
	return rooted(builtFS, "assets")
}

// ReaderBuilt reports whether the embedded reader is the real bundle and not
// the placeholder.
func ReaderBuilt() bool {
	_, err := fs.Stat(BuiltAssets(), "index.html")
	return err == nil
}

func rooted(files embed.FS, dir string) fs.FS {
	sub, err := fs.Sub(files, dir)
	if err != nil {
		// Unreachable: the directory is embedded at build time or the build fails.
		panic(err)
	}
	return sub
}
