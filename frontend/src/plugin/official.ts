/** Bundled plugins compiled into this reader. */

import type { IconName } from "@facet-tools/ui";
import type { TextKey } from "@/chrome";
import adrPlugin from "../../../plugins/adr/src/entry";
import bpmnPlugin from "../../../plugins/bpmn/src/reader/entry";
import dmnPlugin from "../../../plugins/dmn/src/plugin.js";
import wikiPlugin from "../../../plugins/wiki/src/entry";
import "../../../plugins/wiki/src/wiki.css";
import type { PluginEntry } from "./host";

export type OfficialPlugin = {
  /** The id the host registers it under. Comes from the manifest, not the module. */
  id: string;
  /** The entry point the host calls with `atlas`. */
  entry: PluginEntry;
  /** The plugin's entry in the navigation: its name and its icon. */
  nav?: { label: TextKey; icon: IconName };
};

/** The plugins that ship with the reader. */

export const OFFICIAL_PLUGINS: OfficialPlugin[] = [
  {
    id: "adr",
    entry: adrPlugin,
    nav: { label: "shell.nav.item.adr", icon: "scales" },
  },
  {
    id: "bpmn",
    entry: bpmnPlugin,
    nav: { label: "shell.nav.item.bpmn", icon: "flow" },
  },
  { id: "dmn", entry: dmnPlugin, nav: { label: "shell.nav.item.dmn", icon: "flow" } },
  { id: "wiki", entry: wikiPlugin, nav: { label: "shell.nav.item.wiki", icon: "book" } },
];

/** The plugins that should actually run: the catalogue, minus the ids the
 * reader switched off. */

export function activePlugins(
  catalogue: readonly OfficialPlugin[],
  off: readonly string[],
): OfficialPlugin[] {
  const disabled = new Set(off);
  return catalogue.filter((p) => !disabled.has(p.id));
}
