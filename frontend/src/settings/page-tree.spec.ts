/** The page list and its search. */

import { FIRST, GROUPS, PAGES, resolvePage, pageOf, search } from "./page-tree";

describe("The pages", () => {
  it("contain alpha features beside the existing pages in three groups", () => {
    expect(PAGES.map((s) => s.id)).toEqual([
      "themes",
      "language",
      "agent",
      "git-provider",
      "plugins",
      "generative",
      "history",
    ]);
    expect(new Set(PAGES.map((s) => s.g))).toEqual(new Set(GROUPS));
  });

  it("carry the Generative UI page for every core role", () => {
    // The eighth page: a core page and not a plugin case — it drives the
    // switch per core role (`CoreRoleKey`, a closed union), not something a
    // plugin contributes.
    expect(PAGES.map((s) => s.id)).toContain("generative");
    expect(pageOf("generative").t).toBe("Generative UI");
  });

  it("carries the Git provider page, because it asks the host", () => {
    const provider = PAGES.find((s) => s.id === "git-provider");
    expect(provider?.g).toBe("Integrations");
  });

  it("find it too for whoever searches for a self-hosted host", () => {
    // The reporter's path: they have a GitLab that is not recognised. What they
    // type is "gitlab" or "self-hosted" — not "Git forge".
    const ids = (q: string) => search(q).flatMap((g) => g.rows.map((r) => r.id));
    expect(ids("gitlab")).toEqual(["git-provider"]);
    expect(ids("self-hosted")).toEqual(["git-provider"]);
    expect(ids("forges")).toEqual(["git-provider"]);
  });
});

describe("The search in the sidebar", () => {
  const ids = (q: string) => search(q).flatMap((g) => g.rows.map((r) => r.id));

  it("shows everything without a query, in the draft's groups", () => {
    const complete = search("");
    expect(complete.map((g) => g.g)).toEqual(["General", "Integrations", "Data"]);
    expect(complete.flatMap((g) => g.rows)).toHaveLength(PAGES.length);
  });

  it("finds a page by its title", () => {
    expect(ids("themes")).toEqual(["themes"]);
  });

  it("finds a page by what it is about — not only by its name", () => {
    // This is the case the keywords exist for. "vscode" stands in no title
    // and in no subtitle; whoever types it still means exactly one page.
    expect(ids("vscode")).toEqual(["themes"]);
    expect(ids("session isolation")).toEqual(["agent"]);
    expect(ids("localstorage")).toEqual(["history"]);
  });

  it("finds the AI settings page by the search term hooks", () => {
    expect(ids("hooks")).toEqual(["agent"]);
  });

  it("tolerates upper and lower case and a space", () => {
    // Whoever writes "VS Code" searches for the same as with "vscode".
    expect(ids("VS Code")).toEqual(["themes"]);
  });

  it("leaves out empty groups instead of writing them down empty", () => {
    const match = search("unavailable");
    expect(match).toEqual([]);
  });

  it("returns no group at all for a word without a hit", () => {
    // The surface then writes its own sentence. A group without rows would be
    // a heading with nothing under it.
    expect(search("gibtesnicht")).toEqual([]);
  });
});

describe("Settings page validation", () => {
  it("falls back to the first page for anything else", () => {
    // A value no page carries would leave an empty surface on the right — and
    // that looks like an error, not like a page that does not exist.
    expect(resolvePage("gibtesnicht")).toBe(FIRST);
    expect(resolvePage(null)).toBe(FIRST);
    expect(resolvePage(42)).toBe(FIRST);
    expect(resolvePage(undefined)).toBe(FIRST);
  });

  it("leaves a valid id as it is", () => {
    for (const s of PAGES) expect(resolvePage(s.id)).toBe(s.id);
  });
});

describe("pageOf", () => {
  it("gives every id its page", () => {
    expect(pageOf("git-provider").t).toBe("Git provider");
    expect(pageOf("history").t).toBe("History & storage");
  });
});
