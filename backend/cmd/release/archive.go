package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"time"
)

type archiveWriter func(name string, info fs.FileInfo) (io.Writer, error)

func writeArchive(path, root string, stamp time.Time) (err error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer func() {
		err = errors.Join(err, file.Close())
		if err != nil {
			_ = os.Remove(path)
		}
	}()
	var create archiveWriter
	if strings.HasSuffix(path, ".zip") {
		writer := zip.NewWriter(file)
		defer func() { err = errors.Join(err, writer.Close()) }()
		create = func(name string, info fs.FileInfo) (io.Writer, error) {
			header, err := zip.FileInfoHeader(info)
			if err != nil {
				return nil, err
			}
			header.Name = name
			header.Modified = stamp
			header.Method = zip.Deflate
			return writer.CreateHeader(header)
		}
	} else {
		compressed := gzip.NewWriter(file)
		compressed.ModTime = stamp
		defer func() { err = errors.Join(err, compressed.Close()) }()
		writer := tar.NewWriter(compressed)
		defer func() { err = errors.Join(err, writer.Close()) }()
		create = func(name string, info fs.FileInfo) (io.Writer, error) {
			mode := int64(0644)
			if !strings.Contains(name, "/") && !strings.Contains(name, ".") && name != "LICENSE" && name != "NOTICE" {
				mode = 0755
			}
			return writer, writer.WriteHeader(&tar.Header{Name: name, Mode: mode, Size: info.Size(), ModTime: stamp, Typeflag: tar.TypeReg})
		}
	}
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		name, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		out, err := create(filepath.ToSlash(name), info)
		if err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		_, err = io.Copy(out, in)
		return err
	})
}

func readArtifact(dir string) (manifest, artifact, error) {
	var info manifest
	var entry artifact
	path := filepath.Join(dir, "release-manifest.json")
	if err := readJSON(path, &info); err != nil {
		return info, entry, err
	}
	if len(info.Platforms) != 1 {
		return info, entry, errors.New("expected one platform in each manifest")
	}
	entry = info.Platforms[0]
	if !slices.Contains(platforms, entry.Platform) || !versionPattern.MatchString(info.Version) {
		return info, entry, errors.New("invalid artifact version or platform")
	}
	suffix := ".tar.gz"
	if strings.HasPrefix(entry.Platform, "windows_") {
		suffix = ".zip"
	}
	if entry.Archive != "facet-atlas_"+info.Version+"_"+entry.Platform+suffix {
		return info, entry, errors.New("invalid archive name")
	}
	raw, err := os.ReadFile(filepath.Join(dir, "checksums.txt"))
	if err != nil {
		return info, entry, err
	}
	sums := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || sums[fields[1]] != "" {
			return info, entry, errors.New("invalid checksum list")
		}
		sums[fields[1]] = fields[0]
	}
	if err := verify(path, sums[filepath.Base(path)]); err != nil {
		return info, entry, err
	}
	if sums[entry.Archive] != entry.SHA256 {
		return info, entry, errors.New("archive checksum differs from manifest")
	}
	return info, entry, verify(filepath.Join(dir, entry.Archive), entry.SHA256)
}

func collect(source, out string) error {
	paths, err := filepath.Glob(filepath.Join(source, "*", "release-manifest.json"))
	if err != nil {
		return err
	}
	if len(paths) != len(platforms) {
		return fmt.Errorf("expected %d platform artifacts", len(platforms))
	}
	var combined manifest
	entries := map[string]string{}
	var artifacts []artifact
	for _, path := range paths {
		dir := filepath.Dir(path)
		info, entry, err := readArtifact(dir)
		if err != nil {
			return err
		}
		info.Platforms = nil
		if len(entries) == 0 {
			combined = info
		}
		if !reflect.DeepEqual(combined, info) || entries[entry.Platform] != "" {
			return errors.New("platform manifests must agree and cover distinct platforms")
		}
		entries[entry.Platform] = dir
		artifacts = append(artifacts, entry)
	}
	if err := emptyOutput(out); err != nil {
		return err
	}
	for _, entry := range artifacts {
		if err := copyFile(filepath.Join(entries[entry.Platform], entry.Archive), filepath.Join(out, entry.Archive)); err != nil {
			return err
		}
	}
	combined.Platforms = artifacts
	return writeMetadata(out, combined)
}

func extractFile(root, name string, mode fs.FileMode, src io.Reader) error {
	if !filepath.IsLocal(filepath.FromSlash(name)) || !fs.ValidPath(name) || strings.Contains(name, "\\") || name == "." {
		return fmt.Errorf("unsafe archive path %q", name)
	}
	path := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode.Perm())
	if err != nil {
		return err
	}
	_, err = io.Copy(file, src)
	return errors.Join(err, file.Close())
}

func extract(path, root string) error {
	if strings.HasSuffix(path, ".zip") {
		reader, err := zip.OpenReader(path)
		if err != nil {
			return err
		}
		defer reader.Close()
		for _, file := range reader.File {
			if !file.Mode().IsRegular() {
				return fmt.Errorf("unexpected archive entry %q", file.Name)
			}
			in, err := file.Open()
			if err != nil {
				return err
			}
			if err := errors.Join(extractFile(root, file.Name, file.Mode(), in), in.Close()); err != nil {
				return err
			}
		}
		return nil
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	stream, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer stream.Close()
	reader := tar.NewReader(stream)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		if header.Typeflag != tar.TypeReg {
			return fmt.Errorf("unexpected archive entry %q", header.Name)
		}
		if err := extractFile(root, header.Name, fs.FileMode(header.Mode), reader); err != nil {
			return err
		}
	}
}
