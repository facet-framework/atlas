package server

import (
	"github.com/facet-framework/core/registry"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func companionSelectedFixture(t *testing.T) (*Server, string) {
	t.Helper()
	root := ragProject(t, true).Root
	source := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		out, err := exec.Command("git", append([]string{"-C", source}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	git("init", "-q")
	git("config", "user.name", "Fixture")
	git("config", "user.email", "hello@facet-framework.com")
	if err := os.WriteFile(filepath.Join(source, "code.txt"), []byte("selected evidence"), 0600); err != nil {
		t.Fatal(err)
	}
	git("add", ".")
	git("commit", "-qm", "fixture")
	cfg := `source_views:
  repositories:
    backend: {}
  default_view: default
  views:
    default:
      sources:
        backend: {binding: unavailable}
    selected:
      sources:
        backend: {binding: selected}
`
	if err := os.WriteFile(filepath.Join(root, facet.ConfigName), []byte(cfg), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".facet"), 0700); err != nil {
		t.Fatal(err)
	}
	local := "bindings:\n  selected:\n    repository: backend\n    checkout: " + source + "\n"
	if err := os.WriteFile(filepath.Join(root, ".facet/sources.local.yaml"), []byte(local), 0600); err != nil {
		t.Fatal(err)
	}
	config, err := facet.LoadConfigWithSourceView(root, "selected")
	if err != nil {
		t.Fatal(err)
	}
	return &Server{Registry: config.All()[0]}, source
}

func TestCompanionPreservesAtlasSelectedSourceView(t *testing.T) {
	s, source := companionSelectedFixture(t)
	c := s.companion()
	if c.sourceRegistry == nil || c.sourceRegistry.SourceView != s.Registry.SourceView {
		t.Fatal("companion lost frozen selection")
	}
	if _, err := s.selectedConfig(); err != nil {
		t.Fatal(err)
	}
	if c.recordIndex() == "" || !c.hasRAGIndex() {
		t.Fatal("default selection broke selected registry index")
	}
	config := c.ragConfig()
	if !strings.Contains(config, `"--source-view","selected"`) {
		t.Fatalf("child lost selected view: %s", config)
	}
	if !strings.Contains(c.sourceContext(), source) || !strings.Contains(c.sourceContext(), "backend") {
		t.Fatal("selected source checkout missing in agent context")
	}
	c.Bin = fakeClaude(t)
	if err := c.Available(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "code.txt"), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.selectedConfig(); err == nil {
		t.Fatal("UI silently read changed source selection")
	}
	if err := c.Available(); err == nil {
		t.Fatal("companion accepted changed source selection")
	}
}

func TestCompanionRejectsReboundMCPSourceView(t *testing.T) {
	s, _ := companionSelectedFixture(t)
	c := s.companion()
	c.Bin = fakeClaude(t)
	if err := os.WriteFile(filepath.Join(c.Root, ".facet/sources.local.yaml"), []byte("bindings: {}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := c.Available(); err == nil {
		t.Fatal("MCP child would silently lose selected binding")
	}
}

// The CLI supplies a configured Companion, so selection must survive that path
// as well as the server's fallback constructor.
func TestSuppliedCompanionPreservesAtlasSelectedSourceView(t *testing.T) {
	for _, change := range []string{"content", "binding"} {
		t.Run(change, func(t *testing.T) {
			s, source := companionSelectedFixture(t)
			supplied := &Companion{Root: s.Registry.Root, Bin: fakeClaude(t), Model: "configured-model", MaxTurns: 7, PluginsDir: t.TempDir()}
			s.Companion = supplied
			c := s.companion()
			if c == supplied || supplied.sourceRegistry != nil {
				t.Fatal("server must attach selection to a copy of supplied companion")
			}
			if c.Root != supplied.Root || c.Bin != supplied.Bin || c.Model != supplied.Model || c.MaxTurns != supplied.MaxTurns || c.PluginsDir != supplied.PluginsDir {
				t.Fatal("server lost supplied companion configuration")
			}
			if c.sourceRegistry == nil || c.sourceRegistry.SourceView != s.Registry.SourceView {
				t.Fatal("supplied companion lost frozen selection")
			}
			if err := c.Available(); err != nil {
				t.Fatalf("explicit selection must work despite unavailable default: %v", err)
			}
			if c.recordIndex() == "" || !c.hasRAGIndex() {
				t.Fatal("supplied companion lost selected registry index")
			}
			if config := c.ragConfig(); !strings.Contains(config, `"--source-view","selected"`) {
				t.Fatalf("child lost selected view: %s", config)
			}
			if context := c.sourceContext(); !strings.Contains(context, source) || !strings.Contains(context, "backend") {
				t.Fatal("selected source checkout missing in supplied companion context")
			}
			path, content := filepath.Join(source, "code.txt"), "changed"
			if change == "binding" {
				path, content = filepath.Join(c.Root, ".facet/sources.local.yaml"), "bindings: {}\n"
			}
			if err := os.WriteFile(path, []byte(content), 0600); err != nil {
				t.Fatal(err)
			}
			if err := s.companion().Available(); err == nil {
				t.Fatalf("supplied companion accepted changed %s", change)
			}
		})
	}
}
