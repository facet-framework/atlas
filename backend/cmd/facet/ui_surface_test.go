package main

import (
	"reflect"
	"sort"
	"testing"

	"github.com/spf13/pflag"
)

func TestReaderOwnFlags(t *testing.T) {
	var names []string
	newUICmd().Flags().VisitAll(func(f *pflag.Flag) { names = append(names, f.Name) })
	sort.Strings(names)
	want := []string{"companion-bin", "companion-model", "no-open", "port", "record", "registry", "test-report"}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("reader flags = %v; want %v", names, want)
	}
}
