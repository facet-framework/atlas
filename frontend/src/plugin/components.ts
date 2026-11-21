/** Display primitives and tile helpers a plugin may reach for, named as part
 * of the plugin interface rather than as core paths a plugin happens to know. */

export { default as Prose } from "../term/Prose";
export { DevTag } from "../ui";
export { Facts as CatalogueFacts, Header, Reading } from "../contents/parts";
export { unknown, word, numericValue, type CatalogueCount } from "../contents/catalogue";
export type { TileDef } from "./tiles";
export { num, short, STATE_LABEL } from "../derive";
export type { DerivedFeature, DerivedGlossary, DerivedModel, DerivedScenario } from "../derive";
// The repository's state as the core reads it, so a plugin can draw the same
// state line without reaching into a core path. Read, never written: every
// write goes through `bus.call` and the host's `repo.*` tools.
export { FACETRC, FORGE_FROM_REMOTE, repoWithoutGit, type RepoState } from "../repo";
// Page building blocks and page text exposed through the public plugin API.
export { useText, type TextKey } from "../screens/text";
export {
  Bars,
  Diff,
  Facts,
  Inline,
  Markdown,
  markdownHeadings,
  PluginHead,
  Steps,
  noop,
  useLifecycleLabel,
  type DiffLine,
} from "../screens/plugins/shared";
export { SettingsSection } from "../screens/contents/Settings";
export { NotFoundPage } from "../screens/frame/StatusPages";
export { parseYaml, type YamlValue } from "../model/yaml";
export { parseInline, isSafeHref, type MdInline } from "../model/markdown";
