package server

import (
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/facet-framework/core/registry"
)

// indexOf reads a bundle's entry page.
func indexOf(t *testing.T, files fs.FS) []byte {
	t.Helper()
	body, err := fs.ReadFile(files, "index.html")
	if err != nil {
		t.Fatalf("index.html is missing from the bundle: %v", err)
	}
	return body
}

func get(t *testing.T, srv *httptest.Server, path string) []byte {
	t.Helper()
	res, err := srv.Client().Get(srv.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status %d", path, res.StatusCode)
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("GET %s reading: %v", path, err)
	}
	return body
}

func TestPlainRunServesTheReader(t *testing.T) {
	srv := httptest.NewServer((&Server{Registry: facet.Registry{}}).Handler())
	defer srv.Close()

	if got, want := string(get(t, srv, "/")), string(indexOf(t, Assets())); got != want {
		t.Error("a plain run does not serve the built-in reader")
	}
}

// A supplied bundle controls the response independently of the built-in assets.
func TestSuppliedAssetsWinOverBuiltIn(t *testing.T) {
	assets := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("own bundle")}}
	srv := httptest.NewServer((&Server{Registry: facet.Registry{}, Assets: assets}).Handler())
	defer srv.Close()

	if got := string(get(t, srv, "/")); got != "own bundle" {
		t.Errorf("the supplied bundle was bypassed: %q", got)
	}
}
