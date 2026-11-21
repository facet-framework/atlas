package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

var bpmnTestDirectory = func() string {
	_, file, _, _ := runtime.Caller(0)
	if filepath.IsAbs(file) {
		return filepath.Dir(file)
	}
	cwd, err := os.Getwd()
	if err != nil {
		panic(err)
	}
	return cwd
}()

func bpmnTestModule(t testing.TB) (root, module string) {
	t.Helper()
	for dir := bpmnTestDirectory; ; dir = filepath.Dir(dir) {
		data, err := os.ReadFile(filepath.Join(dir, "go.mod"))
		if err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				if fields := strings.Fields(line); len(fields) == 2 && fields[0] == "module" {
					return dir, strings.Trim(fields[1], `"`)
				}
			}
			t.Fatalf("no module declaration in %s", dir)
		}
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		if filepath.Dir(dir) == dir {
			t.Fatalf("no go.mod above BPMN source %s", bpmnTestDirectory)
		}
	}
}

func bpmnSourcePath(t testing.TB, parts ...string) string {
	t.Helper()
	root, _ := bpmnTestModule(t)
	return filepath.Join(append([]string{root}, parts...)...)
}

func linksHostPackage(pkg, sourceModule string) bool {
	for _, prefix := range []string{
		sourceModule + "/internal",
		sourceModule + "/cmd",
		"github.com/facet-framework/core",
		"github.com/facet-framework/atlas/backend/server",
		"github.com/facet-framework/atlas/backend",
	} {
		if pkg == prefix || strings.HasPrefix(pkg, prefix+"/") {
			return true
		}
	}
	return false
}

func TestHostDependencyGuardCoversPublishedModules(t *testing.T) {
	_, sourceModule := bpmnTestModule(t)
	for _, pkg := range []string{
		sourceModule + "/internal/facet",
		sourceModule + "/cmd/facet",
		"github.com/facet-framework/core",
		"github.com/facet-framework/core/registry",
		"github.com/facet-framework/core/cli",
		"github.com/facet-framework/core/corpus",
		"github.com/facet-framework/atlas/backend/server",
		"github.com/facet-framework/atlas/backend/internal/bundledsums",
	} {
		if !linksHostPackage(pkg, sourceModule) {
			t.Errorf("host dependency %q was permitted", pkg)
		}
	}
	for _, pkg := range []string{
		sourceModule + "/plugins/bpmn/sidecar/diagram",
		"github.com/facet-framework/atlas/plugins/bpmn/sidecar/diagram",
		"encoding/xml",
	} {
		if linksHostPackage(pkg, sourceModule) {
			t.Errorf("pure parser dependency %q was refused", pkg)
		}
	}
}
