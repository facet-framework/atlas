import { ROLE_LIST, leavesOut, type BlockKey, type CoreRoleKey } from "./roles";

/** What each role leaves out of the record depth and which role shows it,
 * written out by hand. It is the oracle: it is NOT derived from `leavesOut`
 * or from the role definitions, so moving a block between roles in roles.ts
 * must be followed here on purpose. */

const EXPECTED: Record<CoreRoleKey, [BlockKey, CoreRoleKey][]> = {
  leadership: [
    ["ledger", "dev"],
    ["raw", "dev"],
    ["drift", "dev"],
    ["anchors", "dev"],
    ["decisions", "dev"],
    ["rel", "dev"],
    ["gaps", "author"],
  ],
  dev: [["gaps", "author"]],
  review: [["gaps", "author"]],
  author: [["drift", "dev"]],
  // Three different showers: the pairing must not collapse to "the first role".
  owner: [
    ["rules", "leadership"],
    ["decisions", "dev"],
    ["gaps", "author"],
  ],
  newcomer: [["gaps", "author"]],
  agent: [["gaps", "author"]],
};

const sorted = (pairs: [string, string][]) => [...pairs].sort((a, b) => a[0].localeCompare(b[0]));

describe("leavesOut — over all seven roles", () => {
  it("has the oracle cover exactly the seven roles", () => {
    expect(ROLE_LIST.map((r) => r.key).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(ROLE_LIST.map((r) => r.key))("pairs every omitted block for %s", (key) => {
    const actual = leavesOut(key).map((o): [string, string] => [o.block, o.shownBy.key]);
    expect(sorted(actual)).toEqual(sorted(EXPECTED[key]));
  });

  it("only names a role that really lists the block", () => {
    for (const role of ROLE_LIST) {
      for (const o of leavesOut(role.key)) {
        expect([...o.shownBy.main, ...o.shownBy.side, ...o.shownBy.secs]).toContain(o.block);
        expect(o.shownBy.key).not.toBe(role.key);
      }
    }
  });
});
