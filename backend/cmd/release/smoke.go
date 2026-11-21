package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

func smoke(dir, platform string) error {
	info, entry, err := readArtifact(dir)
	if err != nil {
		return err
	}
	if entry.Platform != platform {
		return errors.New("archive does not match requested platform")
	}
	root, err := os.MkdirTemp("", "facet-atlas-smoke-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(root)
	if err := extract(filepath.Join(dir, entry.Archive), root); err != nil {
		return err
	}
	suffix := ""
	if strings.HasPrefix(platform, "windows_") {
		suffix = ".exe"
	}
	bin := filepath.Join(root, "facet"+suffix)
	if err := verify(bin, entry.BinarySHA256); err != nil {
		return err
	}
	bins, err := sidecars()
	if err != nil {
		return err
	}
	if len(entry.SidecarSHA256) != len(bins) {
		return errors.New("bundled sidecar inventory differs")
	}
	for _, sidecar := range bins {
		if err := verify(filepath.Join(root, sidecar.name+suffix), entry.SidecarSHA256[sidecar.name]); err != nil {
			return err
		}
	}
	raw, err := output(nil, bin, "version", "--json")
	if err != nil {
		return err
	}
	var identity struct {
		AtlasVersion string `json:"atlas_version"`
		UIVersion    string `json:"ui_version"`
		Version      string
		SourceCommit string `json:"source_commit"`
		Dirty        *bool
	}
	if err := json.Unmarshal([]byte(raw), &identity); err != nil {
		return err
	}
	if identity.AtlasVersion != info.Version || identity.UIVersion != info.UIVersion || identity.Version != strings.TrimPrefix(info.CoreVersion, "v") ||
		identity.SourceCommit != info.SourceCommit || identity.Dirty == nil || *identity.Dirty {
		return errors.New("archive binary identity differs from manifest")
	}
	project := filepath.Join(root, "project")
	fixture := filepath.Join(project, "docs", "facets", "features", "demo", "reader")
	if err := os.MkdirAll(fixture, 0755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(fixture, "example.yaml"), []byte("schema_version: \"0.1\"\nid: demo/reader/example\nlifecycle: planned\n"), 0644); err != nil {
		return err
	}
	return smokeServer(bin, project)
}

var serverURL = regexp.MustCompile(`http://(?:localhost|127\.0\.0\.1):[0-9]+`)

func smokeServer(bin, project string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "--root", project, "ui", "--no-open", "--port", "0")
	log := new(bytes.Buffer)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = log
	if err := cmd.Start(); err != nil {
		return err
	}
	defer func() { cancel(); _ = cmd.Wait() }()
	addresses := make(chan string, 1)
	go func() {
		reader := bufio.NewScanner(stdout)
		for reader.Scan() {
			if address := serverURL.FindString(reader.Text()); address != "" {
				addresses <- address
				_, _ = io.Copy(io.Discard, stdout)
				return
			}
		}
		close(addresses)
	}()
	var address string
	select {
	case address = <-addresses:
		if address == "" {
			return errors.New("reader exited before announcing a URL")
		}
	case <-ctx.Done():
		return ctx.Err()
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return err
	}
	client := http.Client{Timeout: 20 * time.Second, Jar: jar}
	get := func(endpoint string) (string, error) {
		request, err := http.NewRequest(http.MethodGet, address+endpoint, nil)
		if err != nil {
			return "", err
		}
		request.Header.Set("Origin", address)
		resp, err := client.Do(request)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return "", fmt.Errorf("GET %s: %s", endpoint, resp.Status)
		}
		body, err := io.ReadAll(resp.Body)
		return string(body), err
	}
	html, err := get("/")
	if err != nil {
		return err
	}
	if !strings.Contains(html, "<html") || !strings.Contains(html, "atlas.js") {
		return errors.New("start page is missing embedded application")
	}
	fmt.Println("GET /: 200, HTML with atlas.js")
	repo, err := get("/api/repo/state")
	if err != nil {
		return err
	}
	if !json.Valid([]byte(repo)) {
		return errors.New("invalid repository state")
	}
	fmt.Println("GET /api/repo/state: 200, JSON")
	foreign, err := http.NewRequest(http.MethodGet, address+"/api/repo/state", nil)
	if err != nil {
		return err
	}
	foreign.Header.Set("Origin", "http://127.0.0.1:1")
	foreignResponse, err := client.Do(foreign)
	if err != nil {
		return err
	}
	defer foreignResponse.Body.Close()
	if foreignResponse.StatusCode != http.StatusForbidden {
		return fmt.Errorf("foreign origin GET /api/repo/state: %s", foreignResponse.Status)
	}
	fmt.Println("GET /api/repo/state from foreign localhost origin: 403")
	corpus, err := get("/api/corpus")
	if err != nil {
		return err
	}
	var ready struct{ Records map[string]string }
	for _, event := range strings.Split(corpus, "\n\n") {
		if data, ok := strings.CutPrefix(event, "event: ready\ndata: "); ok {
			if err := json.Unmarshal([]byte(data), &ready); err != nil {
				return err
			}
		}
	}
	if len(ready.Records) != 1 {
		return errors.New("expected one fixture record in corpus")
	}
	for _, record := range ready.Records {
		if !strings.Contains(record, "\nid: demo/reader/example\n") || !strings.Contains(record, "\nlifecycle: planned\n") {
			return errors.New("fixture record differs")
		}
	}
	fmt.Println("GET /api/corpus: 200, ready with demo/reader/example")
	return smokePlugins(&client, address)
}

func smokePlugins(client *http.Client, address string) error {
	var session struct{ Capabilities map[string]string }
	plugins := []string{"adr", "bpmn", "dmn", "wiki"}
	if err := post(client, address, "/api/plugin/session", "", map[string]any{"plugins": plugins}, &session); err != nil {
		return err
	}
	for _, call := range []struct {
		id, tool string
		args     any
	}{
		{"adr", "repo.list", nil},
		{"bpmn", "bpmn.diagram", map[string]string{"xml": `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"><process id="smoke"><startEvent id="start"/></process></definitions>`}},
		{"dmn", "dmn.inspect", map[string]string{"xml": `<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="model" name="Smoke" namespace="smoke"><decision id="decision" name="Smoke"/></definitions>`}},
		{"wiki", "confluence.state", nil},
	} {
		var reply struct {
			Result        json.RawMessage
			Error, Denied string
		}
		body := map[string]any{"plugin": call.id, "tool": call.tool, "args": call.args}
		if token := session.Capabilities[call.id]; token != "" {
			if err := post(client, address, "/api/plugin/call", token, body, &reply); err != nil {
				return err
			}
		}
		if len(reply.Result) == 0 || reply.Error != "" || reply.Denied != "" {
			return fmt.Errorf("%s did not return a result: %s %s", call.tool, reply.Error, reply.Denied)
		}
		fmt.Printf("POST /api/plugin/call: 200, %s returned a result\n", call.tool)
	}
	return nil
}

func post(client *http.Client, address, endpoint, token string, body, result any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequest(http.MethodPost, address+endpoint, bytes.NewReader(data))
	if err != nil {
		return err
	}
	request.Header.Set("Origin", address)
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("X-Facet-Plugin-Capability", token)
	}
	resp, err := client.Do(request)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("POST %s: %s", endpoint, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(result)
}
