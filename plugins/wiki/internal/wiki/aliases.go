package wiki

import (
	_ "embed"
	"encoding/json"
)

// The dictionary preserves localized spellings used by existing project files.
var localizedAliases = readLocalizedAliases()

//go:embed locales/de.json
var germanAliases []byte

type aliases struct {
	Fields     map[string]string
	Status     map[string]string
	References map[string]string
	Selectors  map[string]string
	Flags      map[string]string
}

func readLocalizedAliases() aliases {
	var result aliases
	if err := json.Unmarshal(germanAliases, &result); err != nil {
		panic(err)
	}
	return result
}

func reverseAliases(dictionary map[string]string) map[string]string {
	reverse := make(map[string]string, len(dictionary))
	for canonical, translated := range dictionary {
		reverse[translated] = canonical
	}
	return reverse
}

var wikiKeyAliases = reverseAliases(localizedAliases.Fields)
var wikiStatusAliases = reverseAliases(localizedAliases.Status)
var LegacyWikiEmbedKeys = reverseAliases(localizedAliases.Selectors)

func LocalizedFlag(name string) string {
	return localizedAliases.Flags[name]
}
