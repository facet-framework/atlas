package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/facet-framework/atlas/plugins/bpmn/sidecar/diagram"
	"github.com/facet-framework/core/registry"
)

// buildSidecar compiles this package into a real binary and answers its
// path and measured checksum — what the broker would verify before running it.
func buildSidecar(t *testing.T) (string, string) {
	t.Helper()
	if _, err := exec.LookPath("go"); err != nil {
		t.Fatal("a Go toolchain is required to test the shipped sidecar process")
	}
	bin := filepath.Join(t.TempDir(), "bpmn")
	if runtime.GOOS == "windows" {
		bin += ".exe"
	}
	cmd := exec.Command("go", "build", "-o", bin, ".")
	cmd.Dir = bpmnTestDirectory
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	raw, err := os.ReadFile(bin)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	return bin, hex.EncodeToString(sum[:])
}

// The file reaches the drawing model through the very client the host uses:
// facet.NewSidecar verifies the checksum, starts the process, frames the call
// and reads the reply. Not dispatch() called directly — that would prove the
// function and not the process the broker starts.
func TestTheHostGetsADrawingModelFromTheRealProcess(t *testing.T) {
	bin, sum := buildSidecar(t)
	side, err := facet.NewSidecar(facet.SidecarSpec{Bin: bin, SHA256: sum})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(side.Stop)

	xml, err := os.ReadFile(bpmnSourcePath(t, "plugins", "bpmn", "sidecar", "diagram", "testdata", "order.bpmn"))
	if err != nil {
		t.Fatal(err)
	}
	args, _ := json.Marshal(diagramArgs{Path: "order.bpmn", XML: string(xml)})
	rep, err := side.Call(context.Background(), facet.SidecarCall{Tool: "bpmn.diagram", Args: args})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Error != "" {
		t.Fatalf("sidecar refused: %s", rep.Error)
	}
	var doc diagram.Document
	if err := json.Unmarshal(rep.Result, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Name != "Order handling" || len(doc.Diagrams) != 1 || len(doc.Diagrams[0].Shapes) < 10 {
		t.Fatalf("unexpected model: name=%q diagrams=%d", doc.Name, len(doc.Diagrams))
	}

	// The process stays up after a refusal: a second, broken call gets an
	// answer, and a third good one still works.
	bad, _ := json.Marshal(diagramArgs{Path: "x.bpmn", XML: "<svg/>"})
	rep, err = side.Call(context.Background(), facet.SidecarCall{Tool: "bpmn.diagram", Args: bad})
	if err != nil || !strings.HasPrefix(rep.Error, "x.bpmn: ") {
		t.Fatalf("a non-BPMN file should be refused by name, got err=%v reply=%+v", err, rep)
	}
	for _, tc := range []struct{ path, xml string }{
		{"large.bpmn", strings.Repeat(" ", diagram.MaxInputBytes+1)},
		{"deep.bpmn", `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">` + strings.Repeat("<a>", 205) + strings.Repeat("</a>", 205) + `</definitions>`},
		{"entity.bpmn", `<!DOCTYPE definitions [<!ENTITY x SYSTEM "file:///no-such-test-file">]><definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" name="&x;"/>`},
	} {
		payload, _ := json.Marshal(diagramArgs{Path: tc.path, XML: tc.xml})
		refused, err := side.Call(context.Background(), facet.SidecarCall{Tool: "bpmn.diagram", Args: payload})
		if err != nil || !strings.HasPrefix(refused.Error, tc.path+": ") || len(refused.Result) > 0 {
			t.Fatalf("%s refusal must name file and return no model: err=%v error=%q result-bytes=%d", tc.path, err, refused.Error, len(refused.Result))
		}
	}
	rep, err = side.Call(context.Background(), facet.SidecarCall{Tool: "bpmn.diagram", Args: args})
	if err != nil || rep.Error != "" {
		t.Fatalf("the process did not survive a refusal: err=%v reply=%+v", err, rep)
	}
}

// The sidecar may link its pure parser, but never Core, the Atlas host or the
// composition/checksum module. Inspect the production graph, not test imports.
// The historical in-module internal/cmd prefixes remain forbidden when testing
// the private development layout; public module boundaries are checked explicitly.
func TestTheSidecarLinksNothingOfTheHost(t *testing.T) {
	cmd := exec.Command("go", "list", "-deps", ".")
	cmd.Dir = bpmnTestDirectory
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go list -deps: %v", err)
	}
	deps := string(out)
	// Precondition: the list is a real one, naming the library it does link.
	_, sourceModule := bpmnTestModule(t)
	if !strings.Contains(deps, sourceModule+"/plugins/bpmn/sidecar/diagram") {
		t.Fatalf("go list -deps did not name the diagram library:\n%s", deps)
	}
	for _, pkg := range strings.Fields(deps) {
		if linksHostPackage(pkg, sourceModule) {
			t.Errorf("the bpmn sidecar links %s", pkg)
		}
	}
}

// What a sidecar could reach beyond its input, it does not: the process
// reads no environment and opens no file. Checked on the source rather than
// by running it, because "never" is a property of the code paths and a run
// only exercises one.
func TestTheSidecarReachesNothingButItsInput(t *testing.T) {
	forbidden := []string{"os.Getenv", "os.LookupEnv", "os.Environ", "os.Open", "os.ReadFile", "os.Create", "os.WriteFile", "net/http", "\"net\"", "os/exec"}
	for _, dir := range []string{bpmnTestDirectory, bpmnSourcePath(t, "plugins", "bpmn", "sidecar", "diagram")} {
		files, _ := filepath.Glob(filepath.Join(dir, "*.go"))
		// Precondition: there are files to look at.
		if len(files) == 0 {
			t.Fatalf("no Go files under %s", dir)
		}
		for _, f := range files {
			if strings.HasSuffix(f, "_test.go") {
				continue
			}
			src, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}
			for _, word := range forbidden {
				if strings.Contains(string(src), word) {
					t.Errorf("%s uses %s", f, word)
				}
			}
		}
	}
}
