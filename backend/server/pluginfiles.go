package server

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/facet-framework/core/registry"
)

// PluginFilesPrefix is where an installed plugin's own files are served, one
// directory per plugin id: PluginFilesPrefix + "<id>/" + "<path inside the
// package>".
const PluginFilesPrefix = "/plugins/"

type pluginSourceFile struct {
	Dev   bool   `json:"dev"`
	Kind  string `json:"kind"`
	Where string `json:"where"`
}

// @facet: customization/plugins/plugin-loading
// @facet-role: primary
// pluginFilesHandler serves one installed plugin's own files: its manifest,
// its entry module, and its assets — nothing else the package might carry.
type pluginFilesHandler struct {
	dir func() string
}

func (h pluginFilesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {

	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")

	base := h.dir()
	if base == "" {
		http.Error(w, "no plugin directory is configured", http.StatusNotFound)
		return
	}

	rest := strings.TrimPrefix(r.URL.Path, PluginFilesPrefix)
	id, sub, ok := strings.Cut(rest, "/")
	if !ok || id == "" || sub == "" {
		http.Error(w, "name a plugin and a file inside it", http.StatusBadRequest)
		return
	}
	if !validPluginPathID(id) {
		http.Error(w, "not a plugin id", http.StatusBadRequest)
		return
	}

	pluginRoot, err := filepath.EvalSymlinks(filepath.Join(base, id))
	if err != nil {
		http.Error(w, "no such plugin", http.StatusNotFound)
		return
	}

	if !allowedPluginPath(sub) {
		http.Error(w, "that file is not served", http.StatusForbidden)
		return
	}

	target := filepath.Join(pluginRoot, filepath.FromSlash(sub))

	resolved, err := filepath.EvalSymlinks(target)
	if err != nil {
		http.Error(w, "no such file", http.StatusNotFound)
		return
	}
	if !withinDir(pluginRoot, resolved) {
		http.Error(w, "that path escapes the plugin directory", http.StatusForbidden)
		return
	}

	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		http.Error(w, "no such file", http.StatusNotFound)
		return
	}

	if code, err := verifyServedPluginFile(base, id, pluginRoot, sub, resolved); err != nil {
		http.Error(w, err.Error(), code)
		return
	}

	f, err := os.Open(resolved)
	if err != nil {
		http.Error(w, "could not read the file", http.StatusInternalServerError)
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", pluginContentType(sub))
	w.Header().Set("Cache-Control", "no-store")
	http.ServeContent(w, r, filepath.Base(resolved), info.ModTime(), f)
}

// withinDir reports whether target is dir itself or lies inside it.
func withinDir(dir, target string) bool {
	rel, err := filepath.Rel(dir, target)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && rel != ".."
}

func allowedPluginPath(sub string) bool {
	clean := path.Clean(sub)
	if clean == "." || strings.HasPrefix(clean, "..") || path.IsAbs(clean) {
		return false
	}
	if clean == "plugin.json" {
		return true
	}
	if strings.HasPrefix(clean, "assets/") {
		return allowedAssetExt(path.Ext(clean))
	}
	return allowedModuleExt(path.Ext(clean))
}

// allowedModuleExt is deliberately narrower than allowedAssetExt: ".json" is
// not in this list. plugin.json is served through its own exact-name check
// above, and every other top-level ".json" a package carries is install
// metadata — grants.json, .source.json — never part of what a plugin's
// module imports. Adding ".json" here once let grants.json through, because
// nothing outside assets/ excludes it by name.
func allowedModuleExt(ext string) bool {
	switch ext {
	case ".js", ".mjs":
		return true
	default:
		return false
	}
}

func allowedAssetExt(ext string) bool {
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
		".woff", ".woff2", ".ttf", ".otf",
		".json":
		return true
	default:
		return false
	}
}

// pluginContentType answers the type this route serves a file as. A fixed
// table rather than mime.TypeByExtension for the module types: some systems
// have no ".mjs" entry in their local mime database, and an entry module
// served as application/octet-stream is refused by a browser's module
// loader before the CSP even gets a say.
func pluginContentType(sub string) string {
	switch path.Ext(sub) {
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".json":
		return "application/json"
	default:
		if t := mime.TypeByExtension(path.Ext(sub)); t != "" {
			return t
		}
		return "application/octet-stream"
	}
}

func verifyServedPluginFile(base, id, pluginRoot, sub, resolved string) (int, error) {
	source, _ := readPluginSource(base, id)
	if source.Dev {

		return 0, nil
	}

	raw, err := os.ReadFile(filepath.Join(pluginRoot, "SHA256SUMS"))
	if errors.Is(err, os.ErrNotExist) {
		// A plugin laid down by hand rather than by `facet plugin add` — no
		// SHA256SUMS was ever written, so there is nothing to compare
		// against and every file is served unchecked, the same judgement
		// this route made about a missing .source.json before this change.
		return 0, nil
	}
	if err != nil {
		return http.StatusInternalServerError, err
	}
	sums, err := facet.ParseSHA256Sums(raw)
	if err != nil {
		return http.StatusInternalServerError, err
	}
	want, listed := sums[sub]
	if !listed {
		return http.StatusNotFound, fmt.Errorf("plugin %s: %s is not part of the installed package", id, sub)
	}
	got, err := hashFile(resolved)
	if err != nil {
		return http.StatusInternalServerError, err
	}
	if got != want {
		return http.StatusConflict, fmt.Errorf("plugin %s: %s does not match the checksum recorded at install", id, sub)
	}
	return 0, nil
}

func hashFile(name string) (string, error) {
	f, err := os.Open(name)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func readPluginSource(base, id string) (pluginSourceFile, error) {
	var source pluginSourceFile

	sourcePath, _ := facet.SourceInfoPath(filepath.Join(base, id), ".source.json")
	raw, err := os.ReadFile(sourcePath)
	if err != nil {
		return source, err
	}
	if err := json.Unmarshal(raw, &source); err != nil {
		return source, err
	}
	return source, nil
}

func validPluginPathID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
		default:
			return false
		}
	}
	return true
}
