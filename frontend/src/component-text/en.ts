import { en as design } from "@facet-tools/ui";
import { enElements } from "./catalog/elements";
import { enCore } from "./catalog/core";

/**
 * The English dictionary — the source of truth for every visible text in FACET.
 *
 * Keys are flat and dotted by area (`shell.history.scope`). A key ending in
 * `.one` / `.other` is a plural pair, read through `plural()`. `{{name}}` marks
 * a parameter; numbers are formatted for the active locale.
 */
export const en = {
  ...design,
  /* Primitives */

  /* Shell */
  "shell.percent": "{{value}}%",
  "shell.history.scope": "up to 200 · this browser only",
  "shell.history.kind.overviewPage": "Overview",
  "shell.history.kind.area": "Area",
  "shell.history.kind.record": "Record",
  "shell.history.kind.plugin": "Plugin",
  "shell.history.kind.overview": "Overview",
  "shell.history.kind.content": "Content",
  "shell.history.kind.settings": "Settings",
  "shell.top.home": "FACET Atlas, to the overview",
  "shell.top.features": "Features",
  "shell.top.proven": "Test named",
  "shell.top.drift": "Drift",
  "shell.mark.drift": "Drift: {{value}} of records",
  "shell.mark.level": "No drift",
  "shell.mark.unmeasured": "Drift not measured",
  "shell.top.goTo": "Go to",
  "shell.top.command": "Go to a record, role or command",
  "shell.top.ctrl": "Ctrl",
  "shell.top.settings": "Settings",
  "shell.top.settingsNew": "new settings page",
  "shell.role.label": "Reader role",
  "shell.role.who": "Who is reading?",
  "shell.role.leadership.name": "Leadership",
  "shell.role.leadership.purpose": "How much of the product a test names and where it sticks.",
  "shell.role.dev.name": "Developer",
  "shell.role.dev.purpose": "Which files have moved away from their record.",
  "shell.role.review.name": "Test & review",
  "shell.role.review.purpose": "Which promises a test carries and which not.",
  "shell.role.author.name": "Record author",
  "shell.role.author.purpose": "Where knowledge is missing and which records fall out of the band.",
  "shell.role.owner.name": "Ownership",
  "shell.role.owner.purpose": "Who owns which area and what nobody owns.",
  "shell.role.newcomer.name": "New here",
  "shell.role.newcomer.purpose": "How the product is built and where to start.",
  "shell.role.agent.name": "Agent",
  "shell.role.agent.purpose": "Registry state, tools and checks before the commit.",
  "shell.nav.item.overview": "Overview",
  "shell.nav.item.product": "Product",
  "shell.nav.item.records": "Records",
  "shell.nav.item.contents": "Contents",
  "shell.nav.item.glossary": "Glossary",
  "shell.nav.item.adr": "Decisions",
  "shell.nav.item.bpmn": "Processes",
  "shell.nav.item.dmn": "DMN",
  "shell.nav.item.wiki": "Wiki",
  "shell.tab.ask": "Ask",
  "shell.tab.more": "More",
  "shell.theme.dark": "Dark",
  "shell.theme.light": "Light",
  "shell.nav.label": "Areas",
  "shell.nav.plugin": "Plugin",
  "shell.more.title": "More",
  "shell.more.role": "Role: {{name}}",
  "shell.boot.mark": "Atlas is reading",
  "shell.boot.phase.connect": "Connecting",
  "shell.boot.phase.config": "Reading configuration",
  "shell.boot.phase.records": "Reading records",
  "shell.boot.phase.enumerate": "Counting files",
  "shell.boot.phase.index": "Indexing anchors",
  "shell.boot.phase.model": "Building the model",
  "shell.boot.phase.ready": "Ready",
  "shell.boot.reconnect": "Reconnect",
  "shell.boot.phases": "Phases",
  "shell.boot.progress": "Progress",
  "shell.boot.shareUnknown": "share not known yet",
  "shell.boot.records": "Records",
  "shell.boot.files": "Files",
  "shell.boot.anchors": "Anchors",
  "shell.boot.noShare": "no share yet",
  /* Catalogs outside the design system, one file each. */
  ...enCore,
  ...enElements,
} as const;

/** Every text key FACET knows. A key missing here is a type error at the call site. */
export type TextKey = keyof typeof en;

/** A complete dictionary: one string for every key, nothing more. */
export type Dictionary = { readonly [K in TextKey]: string };
