//go:build !windows

// Whether a process still runs is asked with signal 0, which only Unix-like
// systems offer; the other sidecar call cases are in plugincall_sidecar_test.go.
package server_test

import (
	"os"
	"path/filepath"
	"strconv"
	"syscall"
	"testing"

	"github.com/facet-framework/atlas/backend/server"
)

func TestTheReaderEndsItsSidecarsWhenItStops(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "pid")
	srv := &server.Server{PluginsDir: installedPlugin(t, pidFile)}

	if got := decode(t, call(t, srv, `{"plugin":"sample","tool":"fixture.pull"}`, capability(t, srv, "sample"))); got.Denied != "" {
		t.Fatalf("the call was denied, so no process was started: %s", got.Denied)
	}
	// The precondition: there is a process, and this is its id.
	raw, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatalf("the sidecar never ran, so there is nothing to end: %v", err)
	}
	pid, err := strconv.Atoi(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if err := syscall.Kill(pid, 0); err != nil {
		t.Fatalf("the sidecar was gone before the reader stopped: %v", err)
	}

	srv.StopPlugins()

	if err := syscall.Kill(pid, 0); err == nil {
		t.Errorf("the sidecar %d is still running after the reader stopped", pid)
	}
}
