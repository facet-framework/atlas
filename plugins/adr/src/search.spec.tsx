/** The decisions as a kind of search hit — the source over the store, the
 * plugin filling the store when it loads, and the area waiting on that one load. */

import { act, render, waitFor } from "@testing-library/react";
import { PluginHost, type AtlasApi } from "../../../frontend/src/plugin/host";
import { buildAdr } from "./model/model";
import adrPlugin from "./entry";
import { adrSearch, Inventory } from "./search";
import { inEnglish } from "../../shared/language.spec-support";

inEnglish();

const FILES = [{ path: "0001-one.md", number: "0001", slug: "one" }];
const BODY = "# One\n\n**Status:** accepted\n**Concerns:** The plugin system\n";

/** A host answer the way /api/plugin/call gives it. */
function answer(tool: string): { ok: true; result: unknown } {
  return tool === "repo.list"
    ? { ok: true, result: { files: FILES } }
    : { ok: true, result: { body: BODY } };
}

describe("adrSuche", () => {
  // Mutation: answer [] instead of null while the store is empty → red.
  it("answers null before any load and for a project without decisions", () => {
    const inventory = new Inventory();
    const source = adrSearch(inventory, () => {});
    expect(source.hits()).toBeNull();
    inventory.apply(buildAdr([], {}));
    expect(source.hits()).toBeNull();
  });

  // Mutation: drop the number from the title → red.
  it("answers one hit per decision, with number, subject and status", () => {
    const inventory = new Inventory();
    inventory.apply(buildAdr(FILES, { "0001-one.md": BODY }));
    const open = jest.fn();
    const hits = adrSearch(inventory, open).hits()!;
    expect(hits.map(({ title, sub, tag }) => ({ title, sub, tag }))).toEqual([
      { title: "0001 One", sub: "The plugin system", tag: "accepted" },
    ]);
    hits[0].open();
    expect(open).toHaveBeenCalledWith("0001-one.md");
  });
});

describe("Inventory", () => {
  it("keeps the model of the load that started last", () => {
    const inventory = new Inventory();
    const older = inventory.begin();
    const next = inventory.begin();
    const newModel = buildAdr(FILES, { "0001-one.md": BODY });
    inventory.apply(newModel, next);
    inventory.apply(buildAdr([], {}), older);
    expect(inventory.current).toBe(newModel);
  });
});

describe("the plugin fills the store when it loads", () => {
  // Mutation: delete the decisions.load() call.tsx → red
  // (the source keeps answering null).
  it("finds decisions before the area was ever opened, and opens one", async () => {
    const host = new PluginHost();
    host.setCapabilities({ adr: "adr-test-capability" });
    host.fetcher = jest.fn(async (_url: unknown, init?: RequestInit) => {
      const { tool } = JSON.parse(String(init?.body)) as { tool: string };
      const body = answer(tool);
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: body.result }),
      };
    }) as unknown as typeof fetch;
    const nav = {
      go: jest.fn(),
      open: jest.fn(),
      openScenario: jest.fn(),
      openArea: jest.fn(),
      closeArea: jest.fn(),
      openSheet: jest.fn(),
      openCatalogue: jest.fn(),
      setRole: jest.fn(),
    };
    host.load("adr", (atlas: AtlasApi) => adrPlugin(atlas), nav);

    const [source] = host.search.list();
    expect(source).toEqual(
      expect.objectContaining({ plugin: "adr", kind: "decisions" }),
    );
    await waitFor(() => expect(source.hits()).toHaveLength(1));
    source.hits()![0].open();
    expect(nav.openArea).toHaveBeenCalledWith("decisions", "0001-one.md");
  });
});

// Mutation: let the area start a load of its own instead of waiting on the
// plugin's -> a second repo.list goes out, and the later of the two answers
// decides what the search shows.
it("lets the area wait on the plugin's one load, so no older answer can overwrite a newer one", async () => {
  const host = new PluginHost();
  host.setCapabilities({ adr: "adr-test-capability" });
  const pending: Array<(files: typeof FILES) => void> = [];
  const tools: string[] = [];
  host.fetcher = jest.fn(async (_url: unknown, init?: RequestInit) => {
    const { tool } = JSON.parse(String(init?.body)) as { tool: string };
    tools.push(tool);
    if (tool === "repo.list")
      return await new Promise((resolve) =>
        pending.push((files) =>
          resolve({
            ok: true,
            status: 200,
            json: async () => ({ result: { files } }),
          }),
        ),
      );
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: { body: BODY } }),
    };
  }) as unknown as typeof fetch;
  host.load("adr", adrPlugin, {
    go: jest.fn(),
    open: jest.fn(),
    openScenario: jest.fn(),
    openArea: jest.fn(),
    closeArea: jest.fn(),
    openSheet: jest.fn(),
    openCatalogue: jest.fn(),
    setRole: jest.fn(),
  });
  // The area reads the records that cite a decision from the corpus; none here.
  host.setCorpus({
    v: { model: { byId: {}, decisionTargets: [] } } as never,
  });
  // The plugin's own load is out before the area was ever opened.
  await waitFor(() => expect(pending).toHaveLength(1));
  const area = host.areas.open("decisions", null)!;
  const ctx = {
    setState: jest.fn(),
    place: {
      depth: 0,
      fid: null,
      sid: null,
      role: "leadership",
      area: null,
    } as const,
  };
  const first = render(<>{host.areas.render(area, ctx)}</>);
  first.unmount();
  render(<>{host.areas.render(area, ctx)}</>);
  await act(async () => undefined);
  // Two mounts of the area, still the one listing.
  expect(tools.filter((t) => t === "repo.list")).toHaveLength(1);
  const [source] = host.search.list();
  expect(source.hits()).toBeNull();
  await act(async () => pending[0](FILES));
  await waitFor(() =>
    expect(source.hits()?.map((h) => h.title)).toEqual(["0001 One"]),
  );
  expect(tools.filter((t) => t === "repo.list")).toHaveLength(1);
});
