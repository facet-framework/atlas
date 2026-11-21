/**
 * A page's status line — the place the house rule would be easiest to break.
 *
 * Three values, and each of them may be missing:
 *
 * - **`status`** has no default (the specification). If it is missing, this shows "nobody
 *   has explained this page's state" — **never** "maintained". A missing
 *   value is never shown as the flattering one.
 * - **`reviewed`** without a date means "never confirmed", not the date of
 *   the last commit. The commit says when somebody touched the file; that is
 *   something other than "a human confirmed the content".
 * - **`owner`** only appears when the page actually sets it, and then with a
 *   note identifying the front matter as its source.
 */

import { tx } from "../../../../frontend/src/i18n";
import type { WikiPage } from "../model/model";

/**
 * Normalized status ids stay independent of the display language. Labels are
 * read at access time, in the language that is active then.
 */
function statusLabel(status: string): [string, string] | null {
  switch (status) {
    case "draft":
      return [tx("ui.wiki-src-wiki.status-draft"), "plan"];
    case "reviewed":
      return [tx("ui.wiki-src-wiki.status-reviewed"), "ok"];
    case "maintained":
      return [tx("ui.wiki-src-wiki.status-maintained"), "ok"];
    case "outdated":
      return [tx("ui.wiki-src-wiki.status-outdated"), "bad"];
    default:
      return null;
  }
}

/** An ISO date, in the order the active language reads it. */
function shownDate(iso: string): string {
  const parts = iso.slice(0, 10).split("-");
  return parts.length === 3
    ? tx("ui.wiki-src-wiki.status-y-m-d", {
        y: parts[0],
        m: parts[1],
        d: parts[2],
      })
    : iso;
}

export default function Status({ p }: { p: WikiPage }) {
  const status = p.front.status ? statusLabel(p.front.status) : null;
  const team = p.front.owner?.team;
  return (
    <>
      <span
        className="wiki-status"
        data-tone={status ? status[1] : "none"}
        data-testid="wiki-page-status"
      >
        {status
          ? status[0]
          : tx("ui.wiki-src-wiki.status-nobody-has-explained-state-page")}
      </span>
      <span className="t-meta" data-testid="wiki-page-reviewed">
        {p.front.reviewed
          ? tx("ui.wiki-src-wiki.status-confirmed-date", {
              date: shownDate(p.front.reviewed),
            })
          : tx("ui.wiki-src-wiki.status-never-confirmed")}
      </span>
      {team ? (
        <span
          className="t-meta"
          data-testid="wiki-page-owner"
          title={tx("ui.wiki-src-wiki.status-owner-team-page-s-header")}
        >
          {tx("ui.wiki-src-wiki.status-team")} {team}
        </span>
      ) : null}
    </>
  );
}
