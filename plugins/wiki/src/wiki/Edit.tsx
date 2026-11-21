/**
 * Edit the body of an existing wiki page and propose it as a branch.
 *
 * Only the prose is editable. The head (front matter) is never loaded into
 * the field and never sent: the host keeps it byte for byte, so `reviewed`,
 * `aliases`, `mirror` and the author's own formatting cannot be lost by an
 * edit made here. The field starts from the page exactly as it was read, and
 * its digest travels as `ifMatch`, so a page that changed meanwhile is
 * refused rather than overwritten.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

import { useState } from "react";
import { tx } from "../../../../frontend/src/i18n";
import { useCall } from "../bus";
import { editPage, type WikiCreated, type WikiCreateStep } from "./host";
import type { WikiPage } from "../model/model";

/**
 * The prose the host would treat as the body: the file after its head and the
 * single blank line that belongs to the head. A page without a head is all
 * body.
 */
export function editableBody(p: Pick<WikiPage, "raw" | "body">): string {
  const hasHead = p.raw !== p.body;
  if (!hasHead) return p.body;
  return p.body.replace(/^\r?\n/, "");
}

export default function Edit({
  p,
  onClose,
}: {
  p: WikiPage;
  onClose: () => void;
}) {
  const call = useCall();
  const [text, setText] = useState(() => editableBody(p));
  const [running, setRunning] = useState<WikiCreateStep | null>(null);
  const [result, setResult] = useState<WikiCreated | null>(null);
  const unchanged = text === editableBody(p);

  async function propose() {
    if (running || unchanged) return;
    setRunning("branch");
    const out = await editPage(
      { path: p.path, raw: p.raw, body: text, title: p.title },
      call,
      setRunning,
    );
    setRunning(null);
    setResult(out);
  }

  if (result) {
    const withoutGit = result.unversioned === true;
    return (
      <div className="wiki-edit" data-testid="wiki-edit-result">
        <p className="t-label">
          {result.failedAt
            ? tx("ui.wiki-src-wiki.edit-stopped-way-what-stands-stands")
            : withoutGit
              ? tx("ui.wiki-src-wiki.edit-saved-without-git-versioning")
              : tx("ui.wiki-src-wiki.edit-proposed-branch")}
        </p>
        <div className="wiki-edit__state t-mono">
          {withoutGit ? null : (
            <p>
              {tx("ui.wiki-src-wiki.edit-branch")} {result.branch}
            </p>
          )}
          {result.sha ? (
            <p>
              {tx("ui.wiki-src-wiki.edit-commit")} {result.sha.slice(0, 8)}
            </p>
          ) : null}
          {result.url ? (
            <p>
              <a href={result.url} target="_blank" rel="noreferrer">
                {result.url}
              </a>
            </p>
          ) : null}
          {result.note ? <p>{result.note.trim()}</p> : null}
          {result.error ? (
            <p className="t-bad" data-testid="wiki-edit-error">
              {result.error}
            </p>
          ) : null}
        </div>
        {result.hint ? <p className="t-meta">{result.hint}</p> : null}
        <button type="button" className="t-btn" onClick={onClose}>
          {tx("ui.wiki-src-wiki.edit-close")}
        </button>
      </div>
    );
  }

  return (
    <div className="wiki-edit" data-testid="wiki-edit">
      <textarea
        className="t-textarea t-textarea--code wiki-edit__text"
        aria-label={tx("ui.wiki-src-wiki.edit-page-body")}
        data-testid="wiki-edit-body"
        value={text}
        rows={18}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        disabled={running !== null}
        style={{ width: "100%", fontFamily: "var(--facet-font-mono)" }}
      />
      <div className="t-row wiki-edit__actions">
        <button
          type="button"
          className="t-btn"
          onClick={onClose}
          disabled={running !== null}
        >
          {tx("ui.wiki-src-wiki.edit-cancel")}
        </button>
        <button
          type="button"
          className="t-btn t-btn--primary"
          data-testid="wiki-edit-propose"
          onClick={() => void propose()}
          disabled={unchanged || running !== null}
        >
          {running
            ? tx("ui.wiki-src-wiki.edit-proposing")
            : tx("ui.wiki-src-wiki.edit-propose-change")}
        </button>
      </div>
    </div>
  );
}
