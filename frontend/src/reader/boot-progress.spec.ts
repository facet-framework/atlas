/** The boot screen's progress: the rank of the scan phase plus its measured
 * share, and no share while the scanner has no denominator. */

import { INDEX_PHASES, initialStatus, type IndexStatus } from "@/model";
import { bootProgress } from "./AtlasLive";

function status(next: Partial<IndexStatus> = {}): IndexStatus {
  return { ...initialStatus(), ...next };
}

describe("bootProgress", () => {
  it("is zero at the start and a hundred at the end", () => {
    expect(bootProgress(status({ phase: "connect" }))).toBe(0);
    expect(bootProgress(status({ phase: "ready" }))).toBe(100);
  });

  it("carries the bar by the rank of the phase", () => {
    const ranks = INDEX_PHASES.map((phase) => bootProgress(status({ phase })));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(ranks).size).toBe(INDEX_PHASES.length);
  });

  it("adds the share within a phase when it knows its denominator", () => {
    // `index` is rank 4 of 6; half the phase is half a rank more.
    expect(bootProgress(status({ phase: "index", done: 0, total: 10 }))).toBe(66);
    expect(bootProgress(status({ phase: "index", done: 5, total: 10 }))).toBe(75);
  });

  it("adds nothing while the phase has no denominator", () => {
    // Exactly the case of `enumerate`: it counts what the denominator would be.
    expect(bootProgress(status({ phase: "enumerate", done: 812, total: 0 }))).toBe(
      bootProgress(status({ phase: "enumerate", done: 0, total: 0 })),
    );
  });

  it("does not accept a denominator the host sends along while counting either", () => {
    // Today the host sends `total: 0` while it counts — but the promise holds
    // here, not there. If it sent an estimate, the bar would show a share
    // while the sentence below still says there is none.
    expect(bootProgress(status({ phase: "enumerate", done: 400, total: 800 }))).toBe(
      bootProgress(status({ phase: "enumerate", done: 0, total: 0 })),
    );
  });

  it("does not exceed a hundred when the host reports more than it announced", () => {
    expect(bootProgress(status({ phase: "ready", done: 99, total: 10 }))).toBe(100);
    expect(bootProgress(status({ phase: "model", done: 40, total: 10 }))).toBeLessThanOrEqual(100);
  });

  it("treats a phase it does not know as the start rather than a step back", () => {
    // `phaseRank` returns -1; a negative bar would be worse than an empty one.
    expect(bootProgress(status({ phase: "wasauchimmer" as IndexStatus["phase"] }))).toBe(0);
  });
});
