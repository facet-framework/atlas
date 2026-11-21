// The BPMN plugin's sidecar — the process that turns a BPMN file into
// something the reader can draw.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/facet-framework/atlas/plugins/bpmn/sidecar/diagram"
)

// call and reply mirror facet.SidecarCall and facet.SidecarReply. Exactly one
// of Result or Error is set in a reply.
type call struct {
	Tool string          `json:"tool"`
	Args json.RawMessage `json:"args,omitempty"`
}

type reply struct {
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

// maxFrame bounds one incoming call: the XML plus its JSON escaping. The
// diagram library refuses above diagram.MaxInputBytes anyway; this stops a
// frame header from asking for more memory than that before it gets there.
const maxFrame = 2*diagram.MaxInputBytes + 4096

const maxHeaderLines = 64

func main() {
	if err := serve(os.Stdin, os.Stdout); err != nil && !errors.Is(err, io.EOF) {
		fmt.Fprintln(os.Stderr, "bpmn sidecar:", err)
		os.Exit(1)
	}
}

// serve answers one call at a time until the host closes stdin.
func serve(r io.Reader, w io.Writer) error {
	in := bufio.NewReader(r)
	for {
		body, err := readFrame(in)
		if err != nil {
			return err
		}
		var c call
		if err := json.Unmarshal(body, &c); err != nil {
			if err := writeFrame(w, reply{Error: "call is not JSON: " + err.Error()}); err != nil {
				return err
			}
			continue
		}
		if err := writeFrame(w, dispatch(c)); err != nil {
			return err
		}
	}
}

// diagramArgs is what bpmn.diagram takes: the file's text, and its path for
// the error message only — the path is never opened.
type diagramArgs struct {
	Path string `json:"path"`
	XML  string `json:"xml"`
}

// @facet: customization/documents/bpmn-plugin
// @facet-role: primary
// dispatch answers one call. A failure is an Error in the reply, never an
// exit: the next call gets an answer too.
func dispatch(c call) reply {
	switch c.Tool {
	case "bpmn.diagram":
		var args diagramArgs
		if err := json.Unmarshal(c.Args, &args); err != nil {
			return reply{Error: "bpmn.diagram: bad args: " + err.Error()}
		}
		doc, err := diagram.Parse([]byte(args.XML))
		if err != nil {
			if args.Path != "" {
				return reply{Error: args.Path + ": " + err.Error()}
			}
			return reply{Error: err.Error()}
		}
		raw, err := json.Marshal(doc)
		if err != nil {
			return reply{Error: "bpmn.diagram: marshalling the result: " + err.Error()}
		}
		return reply{Result: raw}
	default:
		return reply{Error: fmt.Sprintf("bpmn sidecar: no such tool %q", c.Tool)}
	}
}

func writeFrame(w io.Writer, r reply) error {
	body, err := json.Marshal(r)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "Content-Length: %d\r\n\r\n%s", len(body), body)
	return err
}

func readFrame(r *bufio.Reader) ([]byte, error) {
	length := -1
	for lines := 0; ; lines++ {
		if lines >= maxHeaderLines {
			return nil, fmt.Errorf("more than %d header lines", maxHeaderLines)
		}
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if name, value, ok := strings.Cut(line, ":"); ok &&
			strings.EqualFold(strings.TrimSpace(name), "content-length") {
			length, err = strconv.Atoi(strings.TrimSpace(value))
			if err != nil {
				return nil, fmt.Errorf("bad Content-Length: %w", err)
			}
		}
	}
	if length < 0 {
		return nil, errors.New("no Content-Length header")
	}
	if length > maxFrame {
		return nil, fmt.Errorf("call of %d bytes exceeds %d", length, maxFrame)
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, err
	}
	return body, nil
}
