/** The record's own drift mark: how far a record drifted, as the offset and
 * the colour of the mark's second block. */

import { recordDrift } from "./RecordDetailsPage";

const anchors = ["a.ts", "b.ts", "c.ts", "d.ts"].map((path, i) => ({
  path,
  line: i + 1,
  role: "implementation",
}));
const drift = (...paths: string[]) => paths.map((path) => ({ path, changedAt: null }));

describe("recordDrift", () => {
  it("is level in the brand signal without drift", () => {
    expect(recordDrift({ anchors, drift: [] })).toEqual({
      share: 0,
      tone: "signal",
      drifted: 0,
      files: 4,
    });
  });

  it("is a light drift in the warning tone below half the files", () => {
    expect(recordDrift({ anchors, drift: drift("a.ts") })).toMatchObject({
      share: 0.25,
      tone: "warn",
      drifted: 1,
    });
  });

  it("is a strong drift in the bad tone from half the files on", () => {
    expect(recordDrift({ anchors, drift: drift("a.ts", "b.ts") })).toMatchObject({
      share: 0.5,
      tone: "bad",
    });
  });

  it("counts a file once, and a drifted file without an anchor as one of the record's files", () => {
    expect(recordDrift({ anchors: [], drift: drift("x.ts", "x.ts") })).toEqual({
      share: 1,
      tone: "bad",
      drifted: 1,
      files: 1,
    });
  });

  it("is not measured when the host sent no drift comparison", () => {
    expect(recordDrift({ anchors, drift: [], driftMeasured: false })).toBeNull();
  });
});
