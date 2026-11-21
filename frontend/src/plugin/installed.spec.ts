import {
  fetchPluginCapabilities,
  fetchInstalledPlugins,
  resolveInstalledPlugins,
  type InstalledPluginListing,
} from "./installed";

describe("fetchPluginCapabilities", () => {
  it("claims unique plugin identities before their modules are imported", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ capabilities: {} }),
    }));

    await expect(
      fetchPluginCapabilities(["notes", "notes"], fetcher as unknown as typeof fetch),
    ).resolves.toEqual({});
    expect(fetcher).toHaveBeenCalledWith("/api/plugin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plugins: ["notes"] }),
    });
  });

  it("exposes no identities when the session is refused", async () => {
    const fetcher = jest.fn(async () => ({ ok: false }));
    await expect(
      fetchPluginCapabilities(["notes"], fetcher as unknown as typeof fetch),
    ).resolves.toEqual({});
  });

  it("exposes no identities when the session route cannot be reached", async () => {
    const fetcher = jest.fn(async () => {
      throw new Error("network error");
    });
    await expect(
      fetchPluginCapabilities(["notes"], fetcher as unknown as typeof fetch),
    ).resolves.toEqual({});
  });
});

function listing(overrides: Partial<InstalledPluginListing> = {}): InstalledPluginListing {
  return {
    id: "acme-notes",
    name: "Acme Notes",
    version: "1.0.0",
    api: 0,
    entry: "/plugins/acme-notes/entry.js",
    areas: [],
    slots: [],
    dev: false,
    verification: "ok",
    ...overrides,
  };
}

describe("fetchInstalledPlugins", () => {
  it("reads the plugins field off /api/plugins", async () => {
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ plugins: [listing()] }),
    }));

    const out = await fetchInstalledPlugins(fetcher as unknown as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith("/api/plugins");
    expect(out).toEqual([listing()]);
  });

  it("answers with an empty list when the route fails, even if the body looks like a listing", async () => {
    const fetcher = jest.fn(async () => ({
      ok: false,
      json: async () => ({ plugins: [listing()] }),
    }));
    const out = await fetchInstalledPlugins(fetcher as unknown as typeof fetch);
    expect(out).toEqual([]);
  });

  it("answers with an empty list when the reader has no such route at all", async () => {
    const fetcher = jest.fn(async () => {
      throw new Error("network error");
    });
    const out = await fetchInstalledPlugins(fetcher as unknown as typeof fetch);
    expect(out).toEqual([]);
  });
});

describe("resolveInstalledPlugins", () => {
  // Named runnable mutation: delete the `if (bundledIds.has(p.id))` branch —
  // a plugin naming "notes" then gets past the collision check and this test
  // goes red.
  it("blocks an installed plugin that shares a bundled id, without importing it", async () => {
    const importer = jest.fn();
    const { loaded, states } = await resolveInstalledPlugins(
      [listing({ id: "notes" })],
      new Set(["notes"]),
      importer,
    );

    expect(loaded).toEqual([]);
    expect(states).toEqual([
      { status: "blocked", listing: listing({ id: "notes" }), reason: "bundled-id-collision" },
    ]);
    expect(importer).not.toHaveBeenCalled();
  });

  // Named runnable mutation: change `p.verification !== "ok"` to `false` —
  // an unverified plugin is then imported and this test goes red.
  it("does not import a plugin whose verification is not ok", async () => {
    const importer = jest.fn();
    const { loaded, states } = await resolveInstalledPlugins(
      [listing({ verification: "checksum-mismatch" })],
      new Set(),
      importer,
    );

    expect(loaded).toEqual([]);
    expect(states).toEqual([
      {
        status: "not-loaded",
        listing: listing({ verification: "checksum-mismatch" }),
        reason: "checksum-mismatch",
      },
    ]);
    expect(importer).not.toHaveBeenCalled();
  });

  it("loads a verified plugin's default export", async () => {
    const entry = jest.fn();
    const importer = jest.fn(async () => ({ default: entry }));

    const { loaded, states } = await resolveInstalledPlugins([listing()], new Set(), importer);

    expect(importer).toHaveBeenCalledWith("/plugins/acme-notes/entry.js");
    expect(loaded).toEqual([{ id: "acme-notes", entry }]);
    expect(states).toEqual([{ status: "loaded", listing: listing() }]);
  });

  it("reports a failed import as a state and keeps going", async () => {
    const importer = jest.fn(async () => {
      throw new Error("boom");
    });

    const { loaded, states } = await resolveInstalledPlugins([listing()], new Set(), importer);

    expect(loaded).toEqual([]);
    expect(states).toEqual([
      { status: "import-failed", listing: listing(), reason: "Error: boom" },
    ]);
  });

  it("loads the good plugin after rejected and malformed entries", async () => {
    const entry = jest.fn();
    const listings = ["broken", "malformed", "good"].map((id) =>
      listing({ id, entry: `/plugins/${id}/entry.js` }),
    );
    const importer = jest.fn(async (url: string) => {
      if (url.includes("/broken/")) throw new Error("broken module");
      return { default: url.includes("/good/") ? entry : undefined } as { default: typeof entry };
    });
    const { loaded, states } = await resolveInstalledPlugins(listings, new Set(), importer);
    expect(importer.mock.calls).toEqual(listings.map((p) => [p.entry]));
    expect(loaded).toEqual([{ id: "good", entry }]);
    expect(states.map((s) => [s.listing.id, s.status])).toEqual([
      ["broken", "import-failed"],
      ["malformed", "import-failed"],
      ["good", "loaded"],
    ]);
    expect(states[0]).toMatchObject({ reason: "Error: broken module" });
  });

  it("reports a module with no default export as a failed import", async () => {
    const importer = jest.fn(async () => ({ default: undefined }) as unknown as { default: never });

    const { loaded, states } = await resolveInstalledPlugins([listing()], new Set(), importer);

    expect(loaded).toEqual([]);
    expect(states[0].status).toBe("import-failed");
  });
});
