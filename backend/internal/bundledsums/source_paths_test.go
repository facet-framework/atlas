package bundledsums_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

var bundledsumsTestDirectory = func() string {
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

func bundledsumsTestPath(parts ...string) string {
	return filepath.Join(append([]string{bundledsumsTestDirectory}, parts...)...)
}

func moduleIdentity(t testing.TB, root string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		t.Fatalf("reading source module: %v", err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		if fields := strings.Fields(line); len(fields) == 2 && fields[0] == "module" {
			return strings.Trim(fields[1], `"`)
		}
	}
	t.Fatalf("no module declaration in %s", root)
	return ""
}

func bundledsumsSourceModules(t testing.TB) (compositionRoot, producerRoot, compositionModule string) {
	t.Helper()
	producerRoot = bundledsumsTestPath("..", "..", "..")
	return filepath.Join(producerRoot, "backend"), producerRoot, moduleIdentity(t, producerRoot) + "/backend"
}
