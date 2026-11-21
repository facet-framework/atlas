package agents

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The companion's profile has to be loadable from the binary, because the
// process it configures deliberately loads no plugins and so cannot be handed
// the file any other way.
func TestAtlasCompanionProfileIsEmbedded(t *testing.T) {
	profile, err := Load("atlas-companion")
	if err != nil {
		t.Fatalf("the companion profile is not in the binary: %v", err)
	}

	if profile.Name != "atlas-companion" {
		t.Errorf("name = %q; --agent selects a profile by this, so it must match the file", profile.Name)
	}
	if profile.Description == "" {
		t.Error("a profile with no description tells a reader nothing about what it runs")
	}
	if !strings.Contains(profile.Prompt, "record index") {
		t.Error("the profile must tell the agent an index exists, or the index is context nobody uses")
	}
	if strings.Contains(profile.Prompt, "---") {
		t.Error("frontmatter leaked into the prompt")
	}
}

// The profile's tools must match what the companion actually allows. A profile
// promising a tool the process denies produces refusals nobody can explain.
func TestAtlasCompanionDeclaresReadOnlyTools(t *testing.T) {
	profile, err := Load("atlas-companion")
	if err != nil {
		t.Fatal(err)
	}

	want := map[string]bool{"Read": true, "Grep": true, "Glob": true, "mcp__facet__rag_query": true}
	if len(profile.Tools) != len(want) {
		t.Fatalf("tools = %v, want exactly %v", profile.Tools, want)
	}
	for _, tool := range profile.Tools {
		if !want[tool] {
			t.Errorf("%q is not a read-only tool", tool)
		}
	}
}

// The profile has to teach when *not* to retrieve as explicitly as when to.
// A companion that reaches for the index on every question spends a tool call
// to rediscover a record whose id was in the question.
func TestAtlasCompanionTeachesWhenNotToRetrieve(t *testing.T) {
	profile, err := Load("atlas-companion")
	if err != nil {
		t.Fatal(err)
	}
	for _, phrase := range []string{
		"mcp__facet__rag_query",
		"Do not reach for it when",
		"Do not ask the index",
		"Name the record or the article every retrieved claim came from",
	} {
		if !strings.Contains(profile.Prompt, phrase) {
			t.Errorf("the profile never says %q", phrase)
		}
	}
}

func TestParseSplitsFrontmatterFromPrompt(t *testing.T) {
	got := Parse("---\nname: probe\ndescription: A probe\ntools: Read, Grep\nmodel: haiku\n---\n\nBody here.\n")

	if got.Name != "probe" || got.Description != "A probe" || got.Model != "haiku" {
		t.Errorf("header not read: %+v", got)
	}
	if len(got.Tools) != 2 || got.Tools[0] != "Read" || got.Tools[1] != "Grep" {
		t.Errorf("tools = %v", got.Tools)
	}
	if got.Prompt != "Body here." {
		t.Errorf("prompt = %q", got.Prompt)
	}
}

// A document with no header is all prompt. Refusing to run because a header is
// missing would take the companion offline over a stray dash.
func TestParseWithoutFrontmatterIsAllPrompt(t *testing.T) {
	got := Parse("Just the instructions.\n")

	if got.Prompt != "Just the instructions." || got.Name != "" {
		t.Errorf("got %+v", got)
	}
}

// Every profile this plugin ships must be readable, so a broken header is
// caught here rather than in someone's session.
func TestEveryShippedProfileParses(t *testing.T) {
	entries, err := Files.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("no profiles embedded")
	}
	for _, entry := range entries {
		name := strings.TrimSuffix(entry.Name(), ".md")
		profile, err := Load(name)
		if err != nil {
			t.Fatalf("%s: %v", entry.Name(), err)
		}
		if profile.Name != name {
			t.Errorf("%s declares name %q; Claude Code selects by the declared name, so the two must agree",
				entry.Name(), profile.Name)
		}
		if profile.Prompt == "" {
			t.Errorf("%s has no prompt", entry.Name())
		}
	}
}

// The profile explains the schema to an agent that has nothing else: the
// companion runs with no skills, no CLAUDE.md and no plugin loaded, so this
// prose is the only thing standing between it and a misread field.
func TestTheCompanionProfileExplainsEveryTopLevelField(t *testing.T) {
	out, err := exec.Command("go", "list", "-mod=readonly", "-m", "-f", "{{.Dir}}", "github.com/facet-framework/core").Output()
	if err != nil {
		t.Fatalf("locate pinned FACET Core module: %v", err)
	}
	coreDir := strings.TrimSpace(string(out))
	if coreDir == "" {
		t.Fatal("pinned FACET Core module has no source directory")
	}
	raw, err := os.ReadFile(filepath.Join(coreDir, "schema", "facet.schema.json"))
	if err != nil {
		t.Fatalf("read FACET Core schema: %v", err)
	}
	var schema struct {
		Properties map[string]json.RawMessage `json:"properties"`
	}
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatal(err)
	}

	profile, err := Load("atlas-companion")
	if err != nil {
		t.Fatal(err)
	}

	// Fields a reader never has to interpret: two are the record's identity and
	// are explained as such, and authorship is bookkeeping about who wrote which
	// section, which answers no question about the feature.
	skip := map[string]bool{"schema_version": true, "id": true, "authorship": true}

	for field := range schema.Properties {
		if skip[field] {
			continue
		}
		if !strings.Contains(profile.Prompt, "`"+field+"`") {
			t.Errorf("the schema has %q and the profile never mentions it; an agent will guess at it", field)
		}
	}
}
