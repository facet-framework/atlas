package main

import "testing"

func TestComponentFieldAlias(t *testing.T) {
	for _, field := range []string{"komponente", "component"} {
		t.Run(field, func(t *testing.T) {
			got := ParseWikiEmbed(field + ": ProofMatrix\nrecord: registry/layout/source-scanning\n")
			if got.Component != "ProofMatrix" || got.Record != "registry/layout/source-scanning" {
				t.Fatalf("unexpected embedding: %+v", got)
			}
		})
	}
	for _, block := range []string{"komponente: Seal\ncomponent: ProofMatrix\n", "component: ProofMatrix\nkomponente: Seal\n"} {
		if got := ParseWikiEmbed(block); got.Component != "ProofMatrix" {
			t.Fatalf("English field lost precedence: %+v", got)
		}
	}
}
