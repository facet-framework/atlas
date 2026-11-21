import {
  buildAdr,
  countByStatus,
  entryAddress,
  findEntry,
  matchEntries,
} from "./model";

const FILES = [
  { path: "0001-a.md", number: "0001", slug: "a" },
  { path: "0002-b.md", number: "0002", slug: "b" },
];

describe("buildAdr", () => {
  it("joins each file's header lines with its own number, slug and body", () => {
    const model = buildAdr(FILES, {
      "0001-a.md": "# T1\n\n**Status:** accepted\n\n---\n\nbody 1",
      "0002-b.md": "# T2\n\n**Status:** rejected\n\n---\n\nbody 2",
    });

    expect(model.entries).toHaveLength(2);
    expect(model.entries[0]).toMatchObject({
      path: "0001-a.md",
      number: "0001",
      slug: "a",
      title: "T1",
      status: "accepted",
    });
    expect(model.entries[1]).toMatchObject({
      path: "0002-b.md",
      number: "0002",
      slug: "b",
      title: "T2",
      status: "rejected",
    });
  });

  it("carries an entry for a file the host listed but never answered a body for — an empty body, not a dropped entry", () => {
    const model = buildAdr(FILES, {
      "0001-a.md": "# T1\n\n**Status:** accepted\n\n---\n",
    });

    expect(model.entries).toHaveLength(2);
    expect(model.entries[1].body).toBe("");
    expect(model.entries[1].status).toBeUndefined();
  });
});

describe("countByStatus", () => {
  it("counts only entries with a recognised status, leaving the other two known statuses at zero", () => {
    const model = buildAdr(FILES, {
      "0001-a.md": "# T1\n\n**Status:** accepted\n\n---\n",
      "0002-b.md": "# T2\n\n**Status:** accepted\n\n---\n",
    });

    expect(countByStatus(model)).toEqual({
      proposed: 0,
      accepted: 2,
      superseded: 0,
      rejected: 0,
    });
  });

  it("does not count an entry whose status word this reader does not know", () => {
    const model = buildAdr(FILES, {
      "0001-a.md": "# T1\n\n**Status:** eingefroren\n\n---\n",
      "0002-b.md": "# T2\n\n**Status:** accepted\n\n---\n",
    });

    const counts = countByStatus(model);
    expect(counts.accepted).toBe(1);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("counts a German status word of an older ADR under its English value", () => {
    const model = buildAdr(FILES, {
      "0001-a.md": "# T1\n\n**Status:** superseded\n\n---\n",
      "0002-b.md": "# T2\n\n**Status:** superseded\n\n---\n",
    });

    expect(countByStatus(model)).toEqual({
      proposed: 0,
      accepted: 0,
      superseded: 2,
      rejected: 0,
    });
  });
});

describe("matchEntries", () => {
  // The host's shape: paths inside the directory; two files share number 0007.
  const model = {
    ...buildAdr(
      [
        {
          path: "0001-offline-first-storage.md",
          number: "0001",
          slug: "offline-first-storage",
        },
        {
          path: "0007-notification-channels.md",
          number: "0007",
          slug: "notification-channels",
        },
        {
          path: "0007-public-api-tokens.md",
          number: "0007",
          slug: "public-api-tokens",
        },
      ],
      {},
    ),
    directory: "docs/adr/",
  };
  const paths = (address: string) =>
    matchEntries(model, address).map((e) => e.path);

  it.each([
    "docs/adr/0001-offline-first-storage.md",
    "./docs/adr/0001-offline-first-storage.md",
    "adr/0001-offline-first-storage.md",
    "0001-offline-first-storage.md",
    "0001-offline-first-storage",
    "offline-first-storage",
    "1",
    "0001",
    "ADR-0001",
    "adr-1",
    "ADR 001",
  ])("finds the one decision %p names", (address) => {
    expect(paths(address)).toEqual(["0001-offline-first-storage.md"]);
    expect(findEntry(model, address)?.path).toBe(
      "0001-offline-first-storage.md",
    );
  });

  it("answers both decisions a shared number names, and findEntry picks neither", () => {
    for (const address of ["7", "0007", "ADR-007"]) {
      expect(paths(address)).toEqual([
        "0007-notification-channels.md",
        "0007-public-api-tokens.md",
      ]);
      expect(findEntry(model, address)).toBeUndefined();
    }
    expect(paths("docs/adr/0007-public-api-tokens.md")).toEqual([
      "0007-public-api-tokens.md",
    ]);
  });

  it("names nothing for a path in another directory, an unknown name or an empty address", () => {
    expect(paths("docs/other/0001-offline-first-storage.md")).toEqual([]);
    expect(paths("ADR-0099")).toEqual([]);
    expect(paths("  ")).toEqual([]);
  });

  it("gives each entry its repository path, or its own path without a directory", () => {
    expect(entryAddress(model, model.entries[2])).toBe(
      "docs/adr/0007-public-api-tokens.md",
    );
    expect(entryAddress({ entries: model.entries }, model.entries[2])).toBe(
      "0007-public-api-tokens.md",
    );
  });
});
