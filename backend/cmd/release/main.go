// Command release validates, packages and tests Atlas release artifacts.
package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

var platforms = []string{"darwin_amd64", "darwin_arm64", "linux_amd64", "linux_arm64", "windows_amd64", "windows_arm64"}

type manifest struct {
	ManifestVersion int        `json:"manifest_version"`
	Product         string     `json:"product"`
	Version         string     `json:"version"`
	CoreVersion     string     `json:"core_version"`
	UIVersion       string     `json:"ui_version"`
	SourceCommit    string     `json:"source_commit"`
	BuildTime       string     `json:"build_time"`
	Channel         string     `json:"channel"`
	Platforms       []artifact `json:"platforms"`
}

type artifact struct {
	Platform      string            `json:"platform"`
	Archive       string            `json:"archive"`
	SHA256        string            `json:"sha256"`
	BinarySHA256  string            `json:"binary_sha256"`
	SidecarSHA256 map[string]string `json:"sidecar_sha256"`
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "release:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	switch {
	case len(args) == 2 && args[0] == "version":
		_, err := candidate(args[1])
		return err
	case len(args) == 4 && args[0] == "package":
		return packageRelease(args[1], args[2], args[3])
	case len(args) == 3 && args[0] == "collect":
		return collect(args[1], args[2])
	case len(args) == 3 && args[0] == "smoke":
		return smoke(args[1], args[2])
	default:
		return errors.New("usage: release version VERSION | package VERSION PLATFORM OUTPUT | collect INPUT OUTPUT | smoke ARCHIVES PLATFORM")
	}
}

var candidatePattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+-rc\.[1-9][0-9]*$`)

func candidate(version string) (string, error) {
	var source struct {
		Version      string
		Dependencies map[string]string
	}
	if err := readJSON("frontend/package.json", &source); err != nil {
		return "", err
	}
	if version != source.Version || !candidatePattern.MatchString(version) {
		return "", errors.New("version must equal the source release candidate version")
	}
	return source.Dependencies["@facet-tools/ui"], nil
}

func readJSON(path string, value any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, value); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return nil
}

func output(env []string, program string, args ...string) (string, error) {
	cmd := exec.Command(program, args...)
	cmd.Env = env
	data, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s %s: %w\n%s", program, strings.Join(args, " "), err, data)
	}
	return strings.TrimSpace(string(data)), nil
}

func digest(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

func verify(path, expected string) error {
	actual, err := digest(path)
	if err != nil {
		return err
	}
	if actual != expected {
		return fmt.Errorf("checksum differs: %s", path)
	}
	return nil
}

func emptyOutput(path string) error {
	if err := os.MkdirAll(path, 0755); err != nil {
		return err
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	if len(entries) > 0 {
		return errors.New("output directory must be empty")
	}
	return nil
}

func writeMetadata(dir string, info manifest) error {
	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}
	name := "release-manifest.json"
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, append(data, '\n'), 0644); err != nil {
		return err
	}
	sum, err := digest(path)
	if err != nil {
		return err
	}
	lines := []string{sum + "  " + name}
	for _, entry := range info.Platforms {
		lines = append(lines, entry.SHA256+"  "+entry.Archive)
	}
	slices.Sort(lines)
	return os.WriteFile(filepath.Join(dir, "checksums.txt"), []byte(strings.Join(lines, "\n")+"\n"), 0644)
}

func copyFile(source, target string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	return errors.Join(err, out.Close())
}
