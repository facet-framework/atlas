import { runTime } from "./time";

describe("runTime", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-11-21T12:00:00Z")));
  afterEach(() => jest.useRealTimers());

  it("shows only the UTC time for a scan from today", () => {
    expect(runTime("2026-11-21T10:20:00Z", "en")).toBe("10:20 UTC");
  });

  it("includes the date for an older scan", () => {
    expect(runTime("2026-11-16T10:20:00Z", "en")).toBe("Nov 16, 2026, 10:20 UTC");
  });
});
