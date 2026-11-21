package wiki

import (
	_ "embed"
	"encoding/json"
)

// SchemaName is the file name the lint looks the wiki schema up by, in a
// project's schema directory.
const SchemaName = "wiki.schema.json"

// The wiki's schema lives beside the package that reads the files it judges,
// not among the Core schemas under schema/: a build without the wiki carries
// no copy of it, so a project that build scaffolds is not handed a schema for
// a feature it cannot use.
//
//go:embed wiki.schema.json
var schema []byte

// Schema returns the wiki schema a scaffold writes next to the Core schemas.
func Schema() []byte {
	var document map[string]json.RawMessage
	if err := json.Unmarshal(schema, &document); err != nil {
		panic(err)
	}
	var properties map[string]json.RawMessage
	if err := json.Unmarshal(document["properties"], &properties); err != nil {
		panic(err)
	}
	for _, name := range []string{"areas", "categories", "depth"} {
		property, err := json.Marshal(map[string]string{"$ref": "#/properties/" + name})
		if err != nil {
			panic(err)
		}
		properties[localizedAliases.Fields[name]] = property
	}
	data, err := json.Marshal(properties)
	if err != nil {
		panic(err)
	}
	document["properties"] = data
	data, err = json.MarshalIndent(document, "", "  ")
	if err != nil {
		panic(err)
	}
	return append(data, '\n')
}
