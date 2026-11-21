import { tx } from "@/i18n";
/** Assemble the host API passed to each plugin. */

import * as React from "react";
import { num, short, STATE_LABEL } from "../derive";
import { CORE_SEARCH_KIND_IDS } from "../chrome/search-kinds";
import { CORE_PAGE_IDS } from "../settings/page-tree";
import { CORE_CATALOGUE_IDS, unknown, word, numericValue } from "../contents/catalogue";
import { Facts, Header, Reading } from "../contents/parts";
import { CORE_ROLE_IDS } from "../roles";
import ProseDefault from "../term/Prose";
import { DevTag } from "../ui";
import { AreaRegistry } from "./areas";
import { ChatModeRegistry, CORE_MODE_IDS } from "./chat-modes";
import { TileRegistry } from "./tiles";
import { RoleRegistry } from "./roles";
import { SettingsRegistry } from "./pages";
import { SearchRegistry } from "./search";
import { Seen, placeKey } from "./seen";
import { PluginBus, type HostEvent } from "./bus";
import { CommandRegistry } from "./commands";
import { SlotRegistry } from "./slots";
import { ThemeRegistry } from "./themes";
import { narrowVerbs } from "./verbs";

import type { AtlasApi, BusCallResult, PluginCorpus, PluginEntry, PluginUI } from "./api";

export type {
  AtlasApi,
  BusCallResult,
  PlacePublic,
  PluginCorpus,
  PluginData,
  PluginEntry,
  PluginUI,
  SlotName,
  DerivedFeature,
  DerivedGlossary,
  DerivedModel,
  DerivedScenario,
} from "./api";

/** The navigation the host narrows before a plugin ever sees it. */
type HostNav = Parameters<typeof narrowVerbs>[0];

/** Holds the registry and the bus for one running reader. */

// @facet: customization/contributions/plugin-host
// @facet-role: primary
export class PluginHost {
  // Captured when Atlas constructs its host, before installed plugin modules
  // run. Replacing window.fetch later cannot observe capability headers.
  private readonly hostFetch = globalThis.fetch?.bind(globalThis);
  private contributionRevision = 0;
  private readonly published = new Map<string, unknown>();
  private readonly contributionListeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.contributionListeners.add(listener);
    return () => {
      this.contributionListeners.delete(listener);
    };
  };
  readonly version = (): number => this.contributionRevision;
  private readonly contributionsChanged = () => {
    this.contributionRevision++;
    for (const listener of this.contributionListeners) listener();
  };

  /** Parsed data a plugin deliberately exposes to core surfaces. */
  publishedFor(plugin: string, key: string): unknown {
    return this.published.get(`${plugin}:${key}`);
  }

  /** First running plugin publication for a key, only when the reader accepts its shape. */
  publishedValue<T>(key: string, accepts: (value: unknown) => value is T): T | undefined {
    for (const plugin of this.loaded) {
      const value = this.published.get(`${plugin}:${key}`);
      if (accepts(value)) return value;
    }
    return undefined;
  }

  clearPublished(plugin: string): void {
    let changed = false;
    for (const key of this.published.keys()) {
      if (key.startsWith(`${plugin}:`)) {
        this.published.delete(key);
        changed = true;
      }
    }
    if (changed) this.contributionsChanged();
  }

  private publish(plugin: string, key: string, value: unknown): void {
    if (!key || key.includes(":")) return;
    this.published.set(`${plugin}:${key}`, value);
    this.contributionsChanged();
  }

  readonly slots = new SlotRegistry();
  readonly areas = new AreaRegistry();
  /** The settings pages plugins contributed. */

  readonly settings = new SettingsRegistry(this.contributionsChanged);
  /** The catalogue tiles plugins contributed. Beside the other registries for
   * the same reason `settings` and `commands` are: "the plugin is off" and
   * "its tile is absent" have to be the same fact. */

  readonly tiles = new TileRegistry(this.contributionsChanged);
  /** The kinds of search hit plugins contributed. Beside the other registries
   * for the same reason `tiles` is: "the plugin is off" and "its hits are
   * gone from the search" have to be the same fact. */

  readonly search = new SearchRegistry(this.contributionsChanged);
  /** Which plugin places the reader has seen — the unread indicator on a slot
   * and on a plugin's settings page. Read from browser storage on every
   * fresh host; the host that switched a plugin off forgets its places
   * (`Atlas`), so switching it on again marks them new. */

  readonly seen = new Seen();
  /** The roles plugins contributed. Beside the other registries for the same
   * reason `settings` and `tiles` are: "the plugin is off" and "its role is
   * gone" have to be the same fact — there is nothing to migrate, because a
   * chosen role already falls back to the developer's view the moment its
   * key stops resolving. */

  readonly roles = new RoleRegistry(this.contributionsChanged);
  /** The conversation modes plugins contributed. Beside the other registries
   * for the same reason `settings` and `tiles` are: "the plugin is off" and
   * "its mode is absent from the picker" have to be the same fact. */

  readonly chatModes = new ChatModeRegistry(this.contributionsChanged);
  /** The themes plugins contributed, and the ones refused. Beside the other
   * registries for the same reason `settings` and `tiles` are: "the plugin is
   * off" and "its theme is absent from the choice" have to be the same fact. */

  readonly themes = new ThemeRegistry(this.contributionsChanged);
  readonly bus = new PluginBus();
  /** The commands a reader can type, the host's and the plugins' in one list. */

  readonly commands = new CommandRegistry();
  private readonly loaded = new Set<string>();
  private corpus: PluginCorpus | null = null;
  private capabilities: Readonly<Record<string, string>> = {};
  private capabilitiesResolved = false;
  private resolveCapabilities!: () => void;
  private readonly capabilitiesReady = new Promise<void>((resolve) => {
    this.resolveCapabilities = resolve;
  });

  /** Installed code receives the narrowed Atlas API, never this capability map. */
  setCapabilities(capabilities: Readonly<Record<string, string>>): void {
    this.capabilities = { ...capabilities };
    if (!this.capabilitiesResolved) {
      this.capabilitiesResolved = true;
      this.resolveCapabilities();
    }
  }

  /** The host puts the current corpus here on every render. */

  setCorpus(next: PluginCorpus): void {
    this.corpus = next;
  }

  /** Runs one plugin's entry point against its own `atlas` object. */

  load(id: string, entry: PluginEntry, nav: HostNav): boolean {
    if (this.loaded.has(id)) return false;
    this.loaded.add(id);
    entry(this.apiFor(id, nav));
    return true;
  }

  /** Which plugins are running. For the host's reporting, not for a plugin. */
  get loadedIds(): string[] {
    return [...this.loaded];
  }

  /** The host announces that the corpus moved. Not reachable from a plugin. */
  announce(event: HostEvent, payload?: unknown): void {
    this.bus.emitFromHost(event, payload);
  }

  fetcher: typeof fetch = ((...args: Parameters<typeof fetch>) => {
    if (!this.hostFetch) throw new Error("fetch is not available");
    return this.hostFetch(...args);
  }) as typeof fetch;

  private async callTool(id: string, tool: string, args: unknown): Promise<BusCallResult> {
    await this.capabilitiesReady;
    const capability = this.capabilities[id];
    if (!capability) return { ok: false, denied: tx("ui.plugin.host-no-verified-plugin-identity") };
    let res: Response;
    try {
      res = await this.fetcher("/api/plugin/call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Facet-Plugin-Capability": capability,
        },
        body: JSON.stringify({ plugin: id, tool, args }),
      });
    } catch (cause) {
      // The route could not be reached at all. Not a refusal — the host never
      // got to decide — so it is reported as what it is.
      return {
        ok: false,
        error: tx("ui.plugin.host-host-does-not-answer-cause", { cause: String(cause) }),
      };
    }
    if (res.status === 403) {
      // The guard refused before the broker saw it: a foreign origin or a
      // missing Origin header. A decision the host made, so a denial.
      return { ok: false, denied: `${res.status} ${res.statusText}` };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: tx("ui.plugin.host-host-answers-status-text", {
          status: res.status,
          text: res.statusText,
        }),
      };
    }
    let body: { result?: unknown; denied?: string; error?: string };
    try {
      body = (await res.json()) as typeof body;
    } catch (cause) {
      // A 200 that is not JSON. Still not an exception out of `bus.call`:
      // "a refusal is a result" is worth nothing if the error path next to it
      // throws, because the caller ends up writing the try/catch anyway.
      return {
        ok: false,
        error: tx("ui.plugin.host-host-s-answer-not-json-cause", { cause: String(cause) }),
      };
    }
    if (body.denied) return { ok: false, denied: body.denied };
    if (body.error) return { ok: false, error: body.error };
    return { ok: true, result: body.result };
  }

  /** The corpus, or a refusal. */

  private currentCorpus(): PluginCorpus {
    if (!this.corpus) throw new Error("atlas.data was read before the host has a corpus");
    return this.corpus;
  }

  private apiFor(id: string, nav: HostNav): AtlasApi {
    // An arrow function keeps `this` without aliasing it into a variable —
    // the getters below are object methods, and inside them `this` would be
    // the data object rather than the host.
    const corpus = () => this.currentCorpus();
    return {
      api: 0,
      id,
      verbs: narrowVerbs(nav),
      data: {
        get v() {
          return corpus().v;
        },
        section: () => corpus().sections?.[id],
        publish: (key, value) => this.publish(id, key, value),
      },
      slots: {
        mount: (slot, render, opts) => this.slots.register(id, slot, render, opts?.role),
        notify: async (slot, on) => {
          const answer = await this.callTool(id, "ui.notify", { place: slot, on });
          if (answer.ok) this.slots.notify(placeKey(id, slot), on, this.seen);
          return answer;
        },
      },
      commands: {
        // The id is bound here, as it is for slots and for the bus: a call
        // that carried it would let one plugin file a command under another's
        // name, and a reader clearing that plugin would keep this one.
        register: (command) => this.commands.register(id, command),
      },
      theme: {
        // The plugin's id is bound here, not taken as an argument. A call
        // that carried the id would let one plugin write under another's
        // name, which is what the prefix exists to stop.
        contribute: (name, theme) => this.themes.contribute(id, name, theme),
      },
      areas: {
        register: (name, render, opts) => this.areas.register(id, name, render, opts),
      },
      settings: {
        // The core's own seven ids are handed in rather than known by the
        // registry, so there is one list of them and it is the one the
        // surface reads. A registry with its own copy would go stale the
        // first time the core gained or lost a page.
        register: (page) => this.settings.register(id, CORE_PAGE_IDS, page),
      },
      tiles: {
        // Same shape as settings.register above: the core's own ids are
        // handed in, not known by the registry, so there is one list of
        // reserved ids and it is the one catalogue.ts itself defines.
        register: (tileId, tile) => this.tiles.register(id, CORE_CATALOGUE_IDS, tileId, tile),
      },
      search: {
        // Same shape as tiles.register: the core's own kinds are handed in
        // from the one table the palette draws them from.
        register: (kind, source) => this.search.register(id, CORE_SEARCH_KIND_IDS, kind, source),
      },
      roles: {
        // Same shape as settings.register and tiles.register above: the
        // core's own seven ids are handed in, not known by the registry, so
        // there is one list of reserved ids and it is the one roles.ts
        // itself derives from ROLE_LIST.
        register: (roleId, role) => this.roles.register(id, CORE_ROLE_IDS, roleId, role),
      },
      chat: {
        // Same shape again: the one reserved id ("normal") is handed in from
        // chat-modes.ts, not known by the registry itself.
        mode: (modeId, mode) => this.chatModes.register(id, CORE_MODE_IDS, modeId, mode),
      },
      bus: {
        on: (event, fn) => this.bus.on(id, event, fn),
        emit: (event, payload) => this.bus.emit(id, event, payload),

        call: (tool, args) => this.callTool(id, tool, args),
      },
      ui: pluginUI,
    };
  }
}

/** Built once, module-level, and handed to every plugin unchanged: none of
 * these fields close over a plugin id, so there is nothing here for a fresh
 * object per load to buy. */

const pluginUI: PluginUI = {
  react: React,
  h: React.createElement,
  Prose: ProseDefault,
  DevTag,
  Facts,
  Header,
  Reading,
  unknown,
  word,
  numericValue,
  num,
  short,
  STATE_LABEL,
};
