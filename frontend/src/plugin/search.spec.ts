import { PluginHost, type AtlasApi } from "./host";
import { SearchRegistry, type SearchSource } from "./search";

const SOURCE_LABEL: SearchSource = {
  label: "Notes",
  singular: "Notes-Page",
  glyph: "¶",
  tone: "surface",
  hits: () => [{ title: "Instructions", sub: "how", tag: "docs", open: () => {} }],
};

function navSpy() {
  return {
    go: jest.fn(),
    open: jest.fn(),
    openScenario: jest.fn(),
    openArea: jest.fn(),
    closeArea: jest.fn(),
    openSheet: jest.fn(),
    openCatalogue: jest.fn(),
    setRole: jest.fn(),
  };
}

describe("SearchRegistry", () => {
  // Mutation: drop `plugin` from the stored entry → red.
  it("records a contribution under the plugin's name", () => {
    const reg = new SearchRegistry();
    expect(reg.register("notes", new Set(), "pages", SOURCE_LABEL)).not.toBeNull();
    expect(reg.list()).toEqual([
      expect.objectContaining({ kind: "pages", plugin: "notes", label: "Notes" }),
    ]);
  });

  // Mutation: drop the `reserved.has(kind)` check → red.
  it("refuses a kind the core searches itself", () => {
    const reg = new SearchRegistry();
    expect(reg.register("fremd", new Set(["features"]), "features", SOURCE_LABEL)).toBeNull();
    expect(reg.list()).toHaveLength(0);
  });

  // Mutation: drop the duplicate check → red (two sources under one kind).
  it("refuses a kind another plugin already contributed", () => {
    const reg = new SearchRegistry();
    reg.register("one", new Set(), "pages", SOURCE_LABEL);
    expect(reg.register("two", new Set(), "pages", SOURCE_LABEL)).toBeNull();
    expect(reg.list().map((s) => s.plugin)).toEqual(["one"]);
  });

  // Mutation: drop the tone check → red.
  it("refuses a tone the palette does not draw", () => {
    const reg = new SearchRegistry();
    const foreign = { ...SOURCE_LABEL, tone: "neon" } as unknown as SearchSource;
    expect(reg.register("notes", new Set(), "pages", foreign)).toBeNull();
  });

  // Mutation: make the returned function a no-op → red.
  it("takes a contribution away again", () => {
    const reg = new SearchRegistry();
    const remove = reg.register("notes", new Set(), "pages", SOURCE_LABEL);
    remove!();
    expect(reg.list()).toHaveLength(0);
  });
});

describe("atlas.search.register", () => {
  // Mutation: register under a fixed name instead of the host's id → red.
  it("files the source under the id the host loaded the plugin with", () => {
    const host = new PluginHost();
    host.load(
      "notes",
      (atlas: AtlasApi) => void atlas.search.register("pages", SOURCE_LABEL),
      navSpy(),
    );
    expect(host.search.list()).toEqual([
      expect.objectContaining({ kind: "pages", plugin: "notes" }),
    ]);
  });

  // Mutation: hand an empty set instead of KERN_SUCHART_IDS in host.ts → red.
  it("refuses every one of the core's own kinds", () => {
    const host = new PluginHost();
    const replies: unknown[] = [];
    host.load(
      "fremd",
      (atlas: AtlasApi) => {
        for (const kind of [
          "features",
          "promises",
          "glossary",
          "anchor",
          "rules",
          "contents",
          "files",
          "orphans",
          "settings",
        ]) {
          replies.push(atlas.search.register(kind, SOURCE_LABEL));
        }
      },
      navSpy(),
    );
    expect(replies.every((a) => a === null)).toBe(true);
    expect(host.search.list()).toHaveLength(0);
  });
});
