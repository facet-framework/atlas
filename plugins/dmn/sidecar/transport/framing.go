package transport

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
)

const MaxFrame = 8 << 20

// Serve uses the host's Content-Length protocol. Errors do not poison the next call.
func Serve(r io.Reader, w io.Writer) error {
	in := bufio.NewReader(r)
	for {
		length := -1
		for lines := 0; ; lines++ {
			if lines >= 16 {
				return fmt.Errorf("too many headers")
			}
			line, e := in.ReadSlice('\n')
			if e != nil {
				return e
			}
			s := strings.TrimSpace(string(line))
			if s == "" {
				break
			}
			k, v, ok := strings.Cut(s, ":")
			if !ok || !strings.EqualFold(k, "Content-Length") || length != -1 {
				return fmt.Errorf("invalid frame header")
			}
			length, e = strconv.Atoi(strings.TrimSpace(v))
			if e != nil || length < 0 || length > MaxFrame {
				return fmt.Errorf("invalid frame length")
			}
		}
		if length < 0 {
			return fmt.Errorf("missing Content-Length")
		}
		body := make([]byte, length)
		if _, e := io.ReadFull(in, body); e != nil {
			return e
		}
		var call struct {
			Tool string          `json:"tool"`
			Args json.RawMessage `json:"args"`
		}
		var result any
		e := json.Unmarshal(body, &call)
		if e == nil {
			result, e = Dispatch(call.Tool, call.Args)
		}
		var response struct {
			Result any    `json:"result,omitempty"`
			Error  string `json:"error,omitempty"`
		}
		if e != nil {
			response.Error = e.Error()
		} else {
			response.Result = result
		}
		b, e := json.Marshal(response)
		if e != nil {
			return e
		}
		if len(b) > MaxFrame {
			b = []byte(`{"error":"response exceeds frame limit"}`)
		}
		if _, e = fmt.Fprintf(w, "Content-Length: %d\r\n\r\n%s", len(b), b); e != nil {
			return e
		}
	}
}
