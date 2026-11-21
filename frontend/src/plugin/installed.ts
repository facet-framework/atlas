/** The reader's own half of loading an INSTALLED plugin: fetching what
 * `/api/plugins` found under `$XDG_DATA_HOME/facet/plugins/`, and turning
 * each entry that is fit to run into a call to `PluginHost.load` — the exact
 * path the bundled catalogue in `offiziell.ts` already takes. */

import type { PluginEntry } from "./host";

/** One row of the `/api/plugins` answer — installedplugins.go's own shape. */
export type InstalledPluginListing = {
  id: string;
  name: string;
  version: string;
  api: number;
  /** A URL under `/plugins/<id>/…`, ready for `import()` as it stands. */
  entry: string;
  areas: string[];
  slots: string[];
  dev: boolean;
  kind?: string;
  where?: string;
  verification: "ok" | "checksum-mismatch" | "api-unsupported" | "invalid";
};

/** What became of one installed plugin, for the management page to show. */
export type InstalledPluginState =
  | { readonly status: "loaded"; readonly listing: InstalledPluginListing }
  | {
      readonly status: "blocked";
      readonly listing: InstalledPluginListing;
      /** Why it was never even offered a load: not verification's business, but the bundled-id collision. */
      readonly reason: "bundled-id-collision";
    }
  | {
      readonly status: "not-loaded";
      readonly listing: InstalledPluginListing;
      /** Straight from installedplugins.go: "checksum-mismatch", "api-unsupported" or "invalid". */
      readonly reason: InstalledPluginListing["verification"];
    }
  | {
      readonly status: "import-failed";
      readonly listing: InstalledPluginListing;

      readonly reason: string;
    };

/** Fetches what the reader found under `PluginsDir`. Empty on any failure — an unavailable host does not prevent reading. */
export async function fetchInstalledPlugins(
  fetcher: typeof fetch = (...args) => fetch(...args),
): Promise<InstalledPluginListing[]> {
  let res: Response;
  try {
    res = await fetcher("/api/plugins");
  } catch {
    return [];
  }
  if (!res.ok) return [];
  try {
    const body = (await res.json()) as { plugins?: InstalledPluginListing[] };
    return body.plugins ?? [];
  } catch {
    return [];
  }
}

/** `import()`, named so a test can hand in a stand-in without a real module on disk. */
export type PluginImporter = (url: string) => Promise<{ default: PluginEntry }>;

/** Opaque, one-document capabilities issued before installed code is imported. */
export type PluginCapabilities = Readonly<Record<string, string>>;

export async function fetchPluginCapabilities(
  plugins: readonly string[],
  fetcher: typeof fetch = (...args) => fetch(...args),
): Promise<PluginCapabilities> {
  let res: Response;
  try {
    res = await fetcher("/api/plugin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plugins: [...new Set(plugins)] }),
    });
  } catch {
    return {};
  }
  if (!res.ok) return {};
  try {
    const body = (await res.json()) as { capabilities?: Record<string, string> };
    return body.capabilities ?? {};
  } catch {
    return {};
  }
}

const realImporter: PluginImporter = (url) => import(/* webpackIgnore: true */ url);

/** Turns the fetched listing into what Atlas needs: which plugins to
 * actually `host.load`, and the state of every one that did not make it —
 * blocked by a bundled id, refused by its own verification, or a module
 * that `import()` rejected. Every listed plugin ends up in exactly one of
 * the two returned collections; none are silently dropped, which is the
 * difference between "reported" and "measured but never shown" this
 * repository keeps finding. */

export async function resolveInstalledPlugins(
  listing: InstalledPluginListing[],
  bundledIds: ReadonlySet<string>,
  importer: PluginImporter = realImporter,
): Promise<{
  loaded: { id: string; entry: PluginEntry }[];
  states: InstalledPluginState[];
}> {
  const loaded: { id: string; entry: PluginEntry }[] = [];
  const states: InstalledPluginState[] = [];

  for (const p of listing) {
    if (bundledIds.has(p.id)) {
      states.push({ status: "blocked", listing: p, reason: "bundled-id-collision" });
      continue;
    }
    if (p.verification !== "ok") {
      states.push({ status: "not-loaded", listing: p, reason: p.verification });
      continue;
    }
    try {
      const mod = await importer(p.entry);
      if (typeof mod.default !== "function") {
        states.push({
          status: "import-failed",
          listing: p,
          reason: "the module has no default export",
        });
        continue;
      }
      loaded.push({ id: p.id, entry: mod.default });
      states.push({ status: "loaded", listing: p });
    } catch (cause) {
      states.push({ status: "import-failed", listing: p, reason: String(cause) });
    }
  }

  return { loaded, states };
}
