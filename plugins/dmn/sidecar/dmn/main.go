package main

import (
	"errors"
	"fmt"
	"github.com/facet-framework/atlas/plugins/dmn/sidecar/transport"
	"io"
	"os"
)

func main() {
	if err := transport.Serve(os.Stdin, os.Stdout); err != nil && !errors.Is(err, io.EOF) {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
