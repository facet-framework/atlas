# Changelog

## 0.1.0-rc.4

Fourth release candidate: signed release manifests.

- Every release publishes `release-manifest.json.sig`, an Ed25519 signature over the exact bytes of `release-manifest.json`. FACET Core verifies it with an embedded public key before it installs a newer Atlas.
- Each platform entry of `release-manifest.json` states the archive size in bytes.
- Atlas is built with FACET Core 0.1.0-rc.4.

## 0.1.0-rc.3

Third release candidate: readable Scenario Outlines and a product city you can tune.

- A Scenario Outline fills its steps with the values of its first example. Back and forward buttons step through every example of every Examples block, a table of all examples opens below the steps, and choosing a row shows that example. This works on the record page and in the records lens.
- A value of an example column that no step uses is shown beside the example.
- The head of the Knowledge slot matrix stays docked under the view bar while the matrix scrolls.
- Settings › Appearance sets the least height of the product city and how it draws names: a tag at the foundation, a pin on the roof, or map lettering without a box.
- "Names only on hover" hides the names of the city, the plan and the treemap until the pointer rests on a place. It is available in the settings and beside the view switch on the product page.

## 0.1.0-rc.2

Second release candidate: a clearer product city and shared interface components.

- The product city labels each building with a name that hangs from the foundation and moves with the city. A name is hidden where it would overlap another name, the controls or the edge of the view, and more names appear as you zoom in. The selected area and the selected building are always labeled.
- A Full screen button opens the city in full screen; Escape leaves it.
- Charts, timeline, coverage ring and the header bar with history navigation, tab bar and more menu come from the shared FACET UI components (`@facet-tools/ui` 0.1.0-rc.3).
- Plugins can override all four chart series colors through their themes.

## 0.1.0-rc.1

First release candidate: product city, drift and evidence per record, role views, Companion, wiki, plugins with bundled ADR, BPMN and DMN readers, themes and language packs.
