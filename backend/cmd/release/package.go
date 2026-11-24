package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

type inventory struct {
	Dependencies []struct {
		Ecosystem    string
		Name         string
		Version      string
		LicenseFiles []struct {
			Path   string
			SHA256 string
		} `json:"license_files"`
	}
}

type sidecar struct{ name, packagePath string }

func sidecars() ([]sidecar, error) {
	raw, err := os.ReadFile("backend/sidecars.list")
	if err != nil {
		return nil, err
	}
	var result []sidecar
	seen := map[string]bool{}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 || !filepath.IsLocal(fields[0]) || filepath.Base(fields[0]) != fields[0] ||
			!filepath.IsLocal(fields[1]) || filepath.ToSlash(filepath.Clean(fields[1])) != fields[1] ||
			!strings.HasPrefix(fields[1], "plugins/") || !strings.Contains(fields[1], "/sidecar/") || seen[fields[0]] {
			return nil, fmt.Errorf("invalid sidecar declaration: %q", line)
		}
		seen[fields[0]] = true
		result = append(result, sidecar{fields[0], "./" + fields[1]})
	}
	if len(result) == 0 {
		return nil, errors.New("no bundled sidecars declared")
	}
	return result, nil
}

func releaseInputs(version, platform string) (manifest, inventory, error) {
	var info manifest
	var licenses inventory
	ui, err := releaseVersion(version)
	if err != nil {
		return info, licenses, err
	}
	if !slices.Contains(platforms, platform) {
		return info, licenses, errors.New("unsupported platform")
	}
	status, err := output(nil, "git", "status", "--porcelain", "--untracked-files=normal")
	if err != nil {
		return info, licenses, err
	}
	if status != "" {
		return info, licenses, errors.New("release packaging requires a clean checkout")
	}
	for _, asset := range []string{"index.html", "atlas.js", "atlas.css", "theme-init.js"} {
		stat, err := os.Stat(filepath.Join("backend", "server", "assets", asset))
		if err != nil || !stat.Mode().IsRegular() {
			return info, licenses, fmt.Errorf("missing embedded browser asset: %s", asset)
		}
	}
	if err := readJSON("THIRD_PARTY.json", &licenses); err != nil {
		return info, licenses, err
	}
	toolchain, err := output(nil, "go", "env", "GOVERSION")
	if err != nil {
		return info, licenses, err
	}
	var licensedToolchain bool
	for _, dep := range licenses.Dependencies {
		if dep.Ecosystem == "GoToolchain" && dep.Version == toolchain {
			licensedToolchain = true
		}
		for _, file := range dep.LicenseFiles {
			if err := verify(file.Path, file.SHA256); err != nil {
				return info, licenses, err
			}
		}
	}
	if !licensedToolchain {
		return info, licenses, errors.New("Go toolchain differs from the licensed release toolchain")
	}
	core, err := output(nil, "go", "list", "-mod=readonly", "-m", "-f", "{{.Version}}", "github.com/facet-framework/core")
	if err != nil {
		return info, licenses, err
	}
	commit, err := output(nil, "git", "rev-parse", "HEAD")
	if err != nil {
		return info, licenses, err
	}
	stamp, err := output(nil, "git", "log", "-1", "--format=%cI")
	channel := "stable"
	if strings.Contains(version, "-rc.") {
		channel = "rc"
	}
	return manifest{1, "atlas", version, core, ui, commit, stamp, channel, nil}, licenses, err
}

func packageRelease(version, platform, out string) (err error) {
	info, licenses, err := releaseInputs(version, platform)
	if err != nil {
		return err
	}
	if err := emptyOutput(out); err != nil {
		return err
	}
	bins, err := sidecars()
	if err != nil {
		return err
	}
	system, arch, _ := strings.Cut(platform, "_")
	env := append(os.Environ(), "GOOS="+system, "GOARCH="+arch, "CGO_ENABLED=0", "GOWORK=off", "GOPROXY=https://proxy.golang.org", "GOFLAGS=-mod=readonly -p=2")
	stage, err := os.MkdirTemp("", "facet-atlas-package-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	extension := ""
	suffix := ".tar.gz"
	if system == "windows" {
		extension = ".exe"
		suffix = ".zip"
	}
	licensed := map[string]bool{}
	for _, dep := range licenses.Dependencies {
		if dep.Ecosystem == "Go" {
			licensed[dep.Name+" "+dep.Version] = true
		}
	}
	compose := "./backend/cmd/facet"
	targets := []string{compose}
	for _, bin := range bins {
		targets = append(targets, bin.packagePath)
	}
	for _, target := range targets {
		closure, err := output(env, "go", "list", "-deps", "-f", "{{with .Module}}{{if not .Main}}{{.Path}} {{.Version}}{{if .Replace}} replaced{{end}}{{end}}{{end}}", target)
		if err != nil {
			return err
		}
		for _, name := range strings.Split(closure, "\n") {
			if name != "" && !licensed[name] {
				return fmt.Errorf("unlicensed or replaced compiled dependency: %s", name)
			}
		}
	}
	entry := artifact{Platform: platform, Archive: "facet-atlas_" + version + "_" + platform + suffix, SidecarSHA256: map[string]string{}}
	for _, bin := range bins {
		file := filepath.Join(stage, bin.name+extension)
		if _, err := output(env, "go", "build", "-trimpath", "-buildvcs=false", "-o", file, bin.packagePath); err != nil {
			return err
		}
		sum, err := digest(file)
		if err != nil {
			return err
		}
		entry.SidecarSHA256[bin.name] = sum
		sumFile := filepath.Join("backend", "internal", "bundledsums", bin.name+"-"+system+"-"+arch+".sha256")
		original, readErr := os.ReadFile(sumFile)
		if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
			return readErr
		}
		defer func() {
			if readErr == nil {
				err = errors.Join(err, os.WriteFile(sumFile, original, 0644))
				return
			}
			if restoreErr := os.Remove(sumFile); restoreErr != nil && !errors.Is(restoreErr, os.ErrNotExist) {
				err = errors.Join(err, restoreErr)
			}
		}()
		if err := os.WriteFile(sumFile, []byte(sum+"\n"), 0644); err != nil {
			return err
		}
	}
	flags := "-s -w -X main.version=" + strings.TrimPrefix(info.CoreVersion, "v") + " -X main.atlasVersion=" + version + " -X main.uiVersion=" + info.UIVersion
	for _, value := range []string{"SourceCommit=" + info.SourceCommit, "Dirty=false", "Distribution=github-facet-framework-atlas", "BuildChannel=rc", "BuildTime=" + info.BuildTime} {
		flags += " -X github.com/facet-framework/core/release." + value
	}
	binary := filepath.Join(stage, "facet"+extension)
	if _, err := output(env, "go", "build", "-trimpath", "-buildvcs=false", "-ldflags", flags, "-o", binary, compose); err != nil {
		return err
	}
	entry.BinarySHA256, err = digest(binary)
	if err != nil {
		return err
	}
	for _, name := range []string{"LICENSE", "NOTICE", "THIRD_PARTY.json"} {
		if err := copyFile(name, filepath.Join(stage, name)); err != nil {
			return err
		}
	}
	if err := filepath.WalkDir("THIRD_PARTY_LICENSES", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		target := filepath.Join(stage, path)
		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		if !d.Type().IsRegular() {
			return fmt.Errorf("unexpected notice file type: %s", path)
		}
		return copyFile(path, target)
	}); err != nil {
		return err
	}
	epoch, err := time.Parse(time.RFC3339, info.BuildTime)
	if err != nil {
		return err
	}
	path := filepath.Join(out, entry.Archive)
	if err := writeArchive(path, stage, epoch.UTC()); err != nil {
		return err
	}
	entry.SHA256, err = digest(path)
	if err != nil {
		return err
	}
	info.Platforms = []artifact{entry}
	if err := writeMetadata(out, info); err != nil {
		return err
	}
	fmt.Println(entry.Archive)
	return nil
}
