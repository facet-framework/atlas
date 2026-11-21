package server_test

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"github.com/facet-framework/atlas/backend/server"
)

const (
	sidecarEnv = "FACET_UI_SIDECAR_HELPER"
	pidEnv     = "FACET_UI_SIDECAR_PID"
)

func echoReply(tool string) map[string]any {
	switch tool {
	case "fixture.state":
		out := map[string]any{}
		if site := os.Getenv("FACET_UI_SIDECAR_URL"); site != "" {
			out["instance"] = site
			out["instanceSource"] = "FACET_UI_SIDECAR_URL"
		}
		if os.Getenv("FACET_UI_SIDECAR_TOKEN") != "" {
			out["tokenSource"] = "FACET_UI_SIDECAR_TOKEN"
		}
		// An over-disclosing fixture sidecar lets the state-route test prove
		// that account details are discarded rather than merely never sent.
		if email := os.Getenv("FIXTURE_EMAIL"); email != "" {
			out["email"] = email
		}
		return map[string]any{"result": out}
	case "fixture.reach":
		// A test-controlled way to make the sidecar answer with its OWN
		// refusal, the shape TestTheReachRouteReportsTheSidecarsOwnRefusal
		// needs — the same shape a real fixture.reach gives back when
		// FACET_URL et al. are configured wrong on the far side.
		if reason := os.Getenv("FACET_UI_SIDECAR_REACH_ERROR"); reason != "" {
			return map[string]any{"error": reason}
		}
		// A test-controlled result, verbatim, so a route test can prove that
		// every field the sidecar sends survives the host's pass-through.
		if result := os.Getenv("FACET_UI_SIDECAR_REACH_RESULT"); result != "" {
			return map[string]any{"result": json.RawMessage(result)}
		}
		return map[string]any{"result": map[string]any{}}
	default:
		return map[string]any{
			"result": map[string]any{
				"tool":    tool,
				"granted": os.Getenv("FACET_UI_SIDECAR_GRANTED"),
				"secret":  os.Getenv("FACET_UI_SIDECAR_SECRET"),
			},
		}
	}
}

func TestMain(m *testing.M) {
	if os.Getenv(sidecarEnv) == "echo" {
		if path := os.Getenv(pidEnv); path != "" {
			_ = os.WriteFile(path, []byte(strconv.Itoa(os.Getpid())), 0o644)
		}
		echoSidecar()
		return
	}
	os.Exit(m.Run())
}

func echoSidecar() {
	r := bufio.NewReader(os.Stdin)
	for {
		length := -1
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimRight(line, "\r\n")
			if line == "" {
				break
			}
			if name, value, ok := strings.Cut(line, ":"); ok &&
				strings.EqualFold(strings.TrimSpace(name), "content-length") {
				length, _ = strconv.Atoi(strings.TrimSpace(value))
			}
		}
		if length < 0 {
			return
		}
		body := make([]byte, length)
		if _, err := io.ReadFull(r, body); err != nil {
			return
		}
		var call struct {
			Tool string `json:"tool"`
		}
		if json.Unmarshal(body, &call) != nil {
			return
		}
		out, _ := json.Marshal(echoReply(call.Tool))
		fmt.Fprintf(os.Stdout, "Content-Length: %d\r\n\r\n%s", len(out), out)
	}
}

func installedPlugin(t *testing.T, pidFile string) string {
	t.Helper()
	dir := t.TempDir()
	id := filepath.Join(dir, "sample")
	if err := os.MkdirAll(id, 0o755); err != nil {
		t.Fatal(err)
	}
	src, err := os.ReadFile(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	platform := runtime.GOOS + "-" + runtime.GOARCH
	if err := os.WriteFile(filepath.Join(id, "fixture-"+platform), src, 0o755); err != nil {
		t.Fatal(err)
	}
	h := sha256.New()
	h.Write(src)

	write := func(name string, v any) {
		raw, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(id, name), raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// The manifest asks for a secret alongside what it needs to run, plus
	// fixture.state/reach so the state-route tests below have something to
	// call through the same installed plugin.
	write("plugin.json", map[string]any{
		"id":    "sample",
		"tools": []string{"fixture.pull", "fixture.state", "fixture.reach"},
		"sidecar": map[string]any{
			"bin": "fixture",
			"env": []string{
				sidecarEnv, pidEnv,
				"FACET_UI_SIDECAR_GRANTED", "FACET_UI_SIDECAR_SECRET",
				"FACET_UI_SIDECAR_URL", "FACET_UI_SIDECAR_TOKEN",
			},
			"sha256": map[string]string{platform: hex.EncodeToString(h.Sum(nil))},
		},
	})

	write("grants.json", map[string]any{
		"tools": []string{"fixture.pull", "fixture.state", "fixture.reach"},
		"env": []string{
			sidecarEnv, pidEnv, "FACET_UI_SIDECAR_GRANTED",
			"FACET_UI_SIDECAR_URL", "FACET_UI_SIDECAR_TOKEN",
		},
	})

	t.Setenv(sidecarEnv, "echo")
	t.Setenv(pidEnv, pidFile)
	t.Setenv("FACET_UI_SIDECAR_GRANTED", "allowed")
	t.Setenv("FACET_UI_SIDECAR_SECRET", "secret")
	t.Setenv("FACET_UI_SIDECAR_URL", "https://acme.atlassian.net")

	t.Setenv("FACET_UI_SIDECAR_TOKEN", "ATATT-super-secret-value")
	return dir
}

func TestAGrantedToolTravelsFromTheRouteToTheBinaryAndBack(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "pid")
	srv := &server.Server{PluginsDir: installedPlugin(t, pidFile)}
	t.Cleanup(srv.StopPlugins)

	res := call(t, srv, `{"plugin":"sample","tool":"fixture.pull","args":{"space":"ENG"}}`, capability(t, srv, "sample"))
	got := decode(t, res)

	if got.Denied != "" || got.Error != "" {
		t.Fatalf("the granted call did not go through: denied=%q error=%q", got.Denied, got.Error)
	}
	var result struct {
		Tool    string `json:"tool"`
		Granted string `json:"granted"`
		Secret  string `json:"secret"`
	}
	if err := json.Unmarshal(got.Result, &result); err != nil {
		t.Fatalf("the reply is not what the sidecar sent: %v", err)
	}
	// One promise per assertion, and each is a different hop on the path.
	if result.Tool != "fixture.pull" {
		t.Errorf("the tool name did not survive route and broker: %q", result.Tool)
	}
	if result.Granted != "allowed" {
		t.Errorf("the granted variable did not reach the binary: %q", result.Granted)
	}
	if result.Secret != "" {
		t.Errorf("a variable the reader never granted reached the binary: %q", result.Secret)
	}
}

func TestAToolNameCannotInjectASecondAuditLine(t *testing.T) {
	// The route writes through the standard logger, so the test reads it the
	// same way — no hook in the product for a test's benefit.
	var written strings.Builder
	log.SetOutput(&written)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	srv := &server.Server{PluginsDir: t.TempDir()}
	body, err := json.Marshal(map[string]any{
		"plugin": "sample",
		"tool":   "x\nplugin call \"sample\" \"repo.commit\"",
	})
	if err != nil {
		t.Fatal(err)
	}
	call(t, srv, string(body))

	line := written.String()
	// The precondition: something was logged at all. A case about the shape of
	// a line is green for the wrong reason if no line was written.
	if !strings.Contains(line, "plugin deny") {
		t.Fatalf("the refusal was not logged: %q", line)
	}

	if strings.Count(strings.TrimSuffix(line, "\n"), "\n") != 0 {
		t.Errorf("one call wrote more than one line:\n%s", line)
	}
	if !strings.Contains(line, `\nplugin call`) {
		t.Errorf("the forged newline was not escaped: %q", line)
	}
}
