/** Public plugin registration types and host-provided shared dependencies. */

/** Public contracts for Atlas browser plugins. API version zero is unstable.
 * Plugins share the host realm; these types describe integration points,
 * not a sandbox or security boundary. */

import type * as React from "react";
import type { DerivedModel, num, short, STATE_LABEL } from "../derive";
import type { unknown, word, numericValue } from "../contents/catalogue";
import type { Facts, Header, Reading } from "../contents/parts";
import type ProseDefault from "../term/Prose";
import type { DevTag } from "../ui";
import type { AreaEscape, AreaPlaceOf, AreaRenderer } from "./areas";
import type { ChatMode } from "./chat-modes";
import type { TileDef } from "./tiles";
import type { PluginRole } from "./roles";
import type { SettingsPage } from "./pages";
import type { SearchSource } from "./search";
import type { PlacePublic } from "./context";
import type { SlashCommand } from "./commands";
import type { SlotName, SlotRenderer } from "./slots";
import type { PluginTheme, ThemeHandle } from "./themes";
import type { PluginVerbs } from "./verbs";

/** The object passed to a plugin's entry point. API version zero is unstable. */

export type AtlasApi = {
  /** The host API version. */

  readonly api: number;
  /** Which plugin this object was built for. Its own id, never another's. */
  readonly id: string;
  /** Moving the reader. A named subset of Nav — see `verben.ts`. */
  readonly verbs: PluginVerbs;
  readonly slots: {
    /** Ask for a slot. Nothing is drawn here; the host draws when a surface
     * carrying that slot appears, and takes it away when it does not. */

    mount(slot: SlotName, render: SlotRenderer, opts?: { role?: string }): void;
    /** Set the unread indicator on one of this plugin's slots. */

    notify(slot: SlotName, on: boolean): Promise<BusCallResult>;
  };
  readonly theme: {
    /** Contribute a palette of the FACET design system: the `--t-*` tokens it
     * sets for light and dark. The reader offers it beside FACET and Paper
     * as `data-t-theme="<plugin>:<name>"`; tokens left out come from FACET.
     * Unknown tokens are refused with a reason. */

    contribute(name: string, theme: PluginTheme): ThemeHandle;
  };
  readonly commands: {
    /** Contribute a command to the "/" register, under this plugin's name. */

    register(command: SlashCommand): () => void;
  };
  readonly areas: {
    /** Claim a named full surface. Returns false when another plugin already
     * has that name — a conflict somebody has to see, rather than a silent
     * overwrite whose winner depends on load order. */

    register(
      name: string,
      render: AreaRenderer,
      opts?: {
        initial?: (arg: string | null) => unknown;
        /** The area's own Esc ladder. Atlas does not read it: there an area
         * is left through its path and the back step. */

        escape?: AreaEscape;
        /** Which part of the state is a place in the reader's history. */
        place?: AreaPlaceOf;
      },
    ): boolean;
  };
  readonly settings: {
    /** Contribute a page to the reader's settings, under this plugin's name. */

    register(page: SettingsPage): (() => void) | null;
  };
  readonly tiles: {
    /** Contribute a tile to the content catalogue, under this plugin's name. */

    register(id: string, tile: TileDef): (() => void) | null;
  };
  readonly search: {
    /** Contribute a kind of hit to the search (⌘K), under this plugin's name. */

    register(kind: string, source: SearchSource): (() => void) | null;
  };
  readonly roles: {
    /** Contribute a role to the reader's "Read as" menu, under this
     * plugin's name. */

    register(id: string, role: PluginRole): (() => void) | null;
  };
  readonly chat: {
    /** Contribute a conversation mode to the chat, under this plugin's name. */

    mode(id: string, mode: ChatMode): (() => void) | null;
  };

  readonly data: PluginData;
  readonly bus: {
    on(event: string, fn: (payload: unknown) => void): () => void;
    emit(event: string, payload?: unknown): boolean;
    /** Ask the host to run one of this plugin's declared tools. */

    call(tool: string, args?: unknown): Promise<BusCallResult>;
  };

  readonly ui: PluginUI;
};

/** The display primitives handed to a plugin through `atlas.ui`. */

export type PluginUI = {
  /** The host's own React instance — the same module every core file renders with. */
  readonly react: typeof React;
  /** `React.createElement`, named the way JSX compiles to it, for a plugin without its own JSX pipeline. */
  readonly h: typeof React.createElement;
  readonly Prose: typeof ProseDefault;
  readonly DevTag: typeof DevTag;
  readonly Facts: typeof Facts;
  readonly Header: typeof Header;
  readonly Reading: typeof Reading;
  readonly unknown: typeof unknown;
  readonly word: typeof word;
  readonly numericValue: typeof numericValue;
  readonly num: typeof num;
  readonly short: typeof short;
  readonly STATE_LABEL: typeof STATE_LABEL;
};

/** What the host currently holds, for a plugin to read. */

export type PluginCorpus = {
  /** The derived corpus: the same object the core's own surfaces read. */
  v: DerivedModel;
  sections?: Readonly<Record<string, unknown>>;
};

/** The live view of it, so a plugin never holds yesterday's registry. */
export type PluginData = {
  readonly v: DerivedModel;
  section(): unknown;
  /** Publish parsed, read-only data for a core surface. The host scopes the
   * value to this plugin and replaces it as one unit. */
  publish(key: string, value: unknown): void;
};

/** What comes back from `bus.call`. */

export type BusCallResult =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly denied: string }
  | { readonly ok: false; readonly error: string };

/** What a plugin's entry point looks like: one default export, nothing back. */
export type PluginEntry = (atlas: AtlasApi) => void;

export type { PlacePublic, SlotName };

/** The corpus's own types, re-exported so a plugin does not have to reach past
 * this interface into `derive.ts` for the shape of what `atlas.data.v` holds. */

export type { DerivedFeature, DerivedGlossary, DerivedModel, DerivedScenario } from "../derive";
