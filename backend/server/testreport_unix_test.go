//go:build !windows

package server

import (
	"path/filepath"
	"syscall"
	"testing"
)

// The FIFO case of TestNoUsableReportIsNeverANumber: a report path that is a
// named pipe is unreadable, never a count. FIFOs exist only on Unix-like
// systems, so this case lives apart from the portable table.
func TestAReportThatIsAFifoIsUnreadable(t *testing.T) {
	reg, _ := reportRepo(t)
	fifo := filepath.Join(t.TempDir(), "fifo.json")
	if err := syscall.Mkfifo(fifo, 0o644); err != nil {
		t.Skipf("no fifo here: %v", err)
	}
	got := askReport(t, &Server{Registry: reg, TestReport: fifo})
	if got.State != testReportUnreadable || got.Failed != nil {
		t.Errorf("a fifo: want state %q without a count, got %+v", testReportUnreadable, got)
	}
}
