/** What a `facet test --json` report says about the repository this reader
 * serves, for the reviewer's bench. */

import { useEffect, useState } from "react";

export type TestReportState =
  | "none"
  | "unreadable"
  | "ambiguous"
  | "tree-changed"
  | "no-entry"
  | "no-head"
  | "no-git"
  | "stale"
  | "dirty"
  | "unmeasured"
  | "fresh";

export type TestReport = {
  state: TestReportState;
  /** Why an unreadable report could not be read: a fixed code, never an error text. */
  reason?: string;
  /** The commit the report was measured on, and the one the repository is on. */
  reportHead?: string;
  head?: string;
  passed?: number;
  failed?: number;
  unmeasured?: number;
};

export type TestReportReader = () => Promise<TestReport>;

/** The host's own endpoint, as `internal/ui/testreport.go` registers it. */
export const TEST_REPORT_PATH = "/api/test-report";

export const readTestReport: TestReportReader = async () => {
  const response = await fetch(TEST_REPORT_PATH);
  if (!response.ok) throw new Error((await response.text()).trim() || String(response.status));
  return (await response.json()) as TestReport;
};

/** The failed count, or `null` where the report does not carry a measured one. */
export function failedCount(report: TestReport | null): number | null {
  if (!report || report.state !== "fresh") return null;
  return typeof report.failed === "number" ? report.failed : null;
}

/** How often an open bench asks again; the repository can move under it. */
export const TEST_REPORT_INTERVAL_MS = 10000;

/** Reads the report, and asks again on an interval and whenever the window
 * comes back into view: the endpoint judges against the repository's current
 * HEAD on every request, so a bench that asked once would keep drawing
 * "fresh" after a commit. `null` is "not asked yet"; a failed request is the
 * state `none`, because nothing was measured either way. Without a reader
 * nothing is asked. */

export function useTestReport(reader: TestReportReader | null): TestReport | null {
  const [report, setReport] = useState<TestReport | null>(null);
  useEffect(() => {
    if (!reader) return;
    let live = true;
    const ask = () =>
      reader().then(
        (r) => live && setReport(r),
        () => live && setReport({ state: "none" }),
      );
    ask();
    const timer = setInterval(ask, TEST_REPORT_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") ask();
    };
    window.addEventListener("focus", ask);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", ask);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reader]);
  return report;
}

/** The first seven characters of a commit, or "" where none is known. */
export function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : "";
}
