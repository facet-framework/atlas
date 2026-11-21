package server_test

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/facet-framework/atlas/backend/server"
)

// The Go constant and the TypeScript literal are two spellings of one
// promise: the api number this reader offers. Nothing compared them until
// this test — a Go constant that drifted from what frontend/src/plugin/
// host.ts actually hands a plugin would report "api 1 offered" while the
// loader that reads /api/plugins still built its atlas object with 0, and an
// installed plugin declaring api 1 would be told it may load, then run
// against an object built for a different contract.
func TestTheHostAPIConstantMatchesTheLoadersOwnLiteral(t *testing.T) {
	root, err := os.Getwd()
	if err != nil {
		t.Fatalf("locating Atlas module: %v", err)
	}
	// Resolve the module root independently of the test package directory depth.
	for {
		if _, err := os.Stat(filepath.Join(root, "go.mod")); err == nil {
			break
		} else if !os.IsNotExist(err) {
			t.Fatalf("locating Atlas module: %v", err)
		}
		parent := filepath.Dir(root)
		if parent == root {
			t.Fatal("no go.mod above the Atlas test directory")
		}
		root = parent
	}
	src, err := os.ReadFile(filepath.Join(root, "frontend/src/plugin/host.ts"))
	if err != nil {
		t.Fatalf("reading host.ts: %v", err)
	}

	re := regexp.MustCompile(`(?m)^\s*api:\s*(\d+),`)
	m := re.FindSubmatch(src)
	if m == nil {
		t.Fatal("host.ts must assign a literal 'api:' field — this test measures nothing")
	}

	want := fmt.Sprintf("%d", server.HostAPI)
	if string(m[1]) != want {
		t.Errorf("server.HostAPI is %s, host.ts hands a plugin api %s", want, string(m[1]))
	}
}
