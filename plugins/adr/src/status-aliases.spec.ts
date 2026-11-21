import { adrCounts, adrItem } from "./entry";

const entry = (status?: string) => ({
  path: "docs/adr/0001-x.md",
  number: "0001",
  slug: "x",
  body: "",
  errorState: null,
  ...(status === undefined ? {} : { status }),
});

describe("the status an ADR entry hands to the views", () => {
  it.each([
    ["proposed", "proposed"],
    ["accepted", "accepted"],
    ["superseded", "superseded"],
    ["rejected", "rejected"],
  ])("reads the English value %s", (status, viewId) => {
    expect(adrItem(entry(status), 0).status).toBe(viewId);
  });

  it.each([
    ["proposed", "proposed"],
    ["accepted", "accepted"],
    ["superseded", "superseded"],
    ["rejected", "rejected"],
  ])("reads the German alias %s exactly as %s", (alias, english) => {
    expect(adrItem(entry(alias), 0).status).toBe(
      adrItem(entry(english), 0).status,
    );
  });

  it("counts an English and a German status word of the same state together", () => {
    const counts = adrCounts([
      adrItem(entry("accepted"), 0),
      adrItem(entry("accepted"), 0),
    ]);
    expect(counts.accepted).toBe(2);
  });

  it("leaves a word it does not know, and no status at all, as unknown", () => {
    expect(adrItem(entry("frozen"), 0).status).toBe("unknown");
    expect(adrItem(entry(), 0).status).toBe("unknown");
  });
});
