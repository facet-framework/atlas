// Package agents holds the subagent profiles Atlas installs, and makes
// them readable from the binary as well.
package agents

import (
	"embed"
	"strings"
)

//go:embed *.md
var Files embed.FS

// Profile is a subagent profile: its frontmatter, and the prompt below it.
type Profile struct {
	Name        string
	Description string
	// Tools is the frontmatter's list, split and trimmed. It states what the
	// profile is for; it does not enforce anything. Enforcement is the caller's
	// job, because a profile is text and text does not restrict a process.
	Tools  []string
	Model  string
	Prompt string
}

// Load reads one profile by file name, without the extension.
// @facet: assistance/preferences/agent-sandboxing
// @facet-role: related
func Load(name string) (Profile, error) {
	data, err := Files.ReadFile(name + ".md")
	if err != nil {
		return Profile{}, err
	}
	return Parse(string(data)), nil
}

// Parse splits a profile into its frontmatter and its prompt.
func Parse(text string) Profile {
	body := strings.ReplaceAll(text, "\r\n", "\n")
	var profile Profile

	if strings.HasPrefix(body, "---\n") {
		if end := strings.Index(body[4:], "\n---"); end >= 0 {
			header := body[4 : 4+end]
			rest := body[4+end+4:]
			profile = parseHeader(header)
			body = strings.TrimLeft(rest, "\n")
		}
	}
	profile.Prompt = strings.TrimSpace(body)
	return profile
}

func parseHeader(header string) Profile {
	var profile Profile
	for _, line := range strings.Split(header, "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		switch strings.TrimSpace(key) {
		case "name":
			profile.Name = value
		case "description":
			profile.Description = value
		case "model":
			profile.Model = value
		case "tools":
			for _, tool := range strings.Split(value, ",") {
				if tool = strings.TrimSpace(tool); tool != "" {
					profile.Tools = append(profile.Tools, tool)
				}
			}
		}
	}
	return profile
}
