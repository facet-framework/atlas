package diagram

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

var diagramTestDirectory = func() string {
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

func diagramTestPath(parts ...string) string {
	return filepath.Join(append([]string{diagramTestDirectory}, parts...)...)
}

func diagramModulePath(t testing.TB, parts ...string) string {
	t.Helper()
	for dir := diagramTestDirectory; ; dir = filepath.Dir(dir) {
		info, err := os.Stat(filepath.Join(dir, "go.mod"))
		if err == nil && !info.IsDir() {
			return filepath.Join(append([]string{dir}, parts...)...)
		}
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		if filepath.Dir(dir) == dir {
			t.Fatalf("no go.mod above diagram source %s", diagramTestDirectory)
		}
	}
}
