import { useTranslation } from "react-i18next";
import i18n, { tx } from "@/i18n";
import type { GenTile, GeneratedGenTile } from "./tiles";
import { relativeTime, stale } from "./origin";
import { hashContext } from "./context";
import type { GenEntry } from "./storage";
import type { GenRunState } from "./run";
import type { DerivedModel } from "../derive";
import Answer from "../ask/Answer";
import { TileBody } from "./TileBody";

const RE_ICON = (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path
      d="M11.4 7.6A4.5 4.5 0 1 1 10 3.9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
    <path
      d="M10.2 1.6v2.6H7.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function Origin({
  tile,
  entry,
  v,
}: {
  tile: GeneratedGenTile;
  entry: GenEntry | null;
  v: DerivedModel;
}) {
  useTranslation();
  if (!entry) {
    return (
      <>
        <span>{tx("ui.generative.tile-no-text")}</span>
      </>
    );
  }
  const isStale = stale(entry, hashContext(v, tile.ctx), i18n.resolvedLanguage ?? i18n.language);
  return (
    <>
      <span>
        {tx("ui.generative.tile-from")} {entry.ctxN} {tx("ui.generative.tile-of")} {entry.ofN}{" "}
        {tx("ui.generative.tile-records")}
      </span>
      <span>{entry.model}</span>
      <span title={new Date(entry.at).toLocaleString(i18n.resolvedLanguage ?? "en")}>
        {relativeTime(entry.at)}
      </span>
      {isStale ? (
        <span className="stale" data-testid="tile-stale">
          {tx("ui.generative.tile-records-changed-since-run")}
        </span>
      ) : null}
      {entry.err ? (
        <span className="err">
          {tx("ui.generative.tile-regeneration-failed")} · {entry.err}
        </span>
      ) : null}
    </>
  );
}

function LoadTile({ tile, run }: { tile: GeneratedGenTile; run: GenRunState }) {
  const all = run.read >= tile.ctx.length;
  return (
    <div
      className={`gen-load ${run.read === 0 && run.text === "" ? "ctx" : ""} ${all ? "write" : ""}`}
    >
      <div className="marks">
        {tile.ctx.map((id, i) => (
          <i
            key={id}
            className={i < run.read || all ? "done" : i === run.read ? "now" : ""}
            style={{ animationDelay: `${i * -0.32}s` }}
            title={id}
          />
        ))}
      </div>
      <p className="gen-phase t-mono">
        {run.phase}
        {all ? (
          <span className="ell">
            <i>.</i>
            <i>.</i>
            <i>.</i>
          </span>
        ) : null}
      </p>
    </div>
  );
}

export function GeneratedTile({
  tile,
  v,
  entry,
  run,
  errorWithoutText,
  onRegen,
}: {
  tile: GeneratedGenTile;
  v: DerivedModel;
  entry: GenEntry | null;
  run: GenRunState | null;
  /** A run's own failure when no cached text exists to carry it — see
   * `useGenRuns`'s `failedWithoutText`. `entry?.err` covers the
   * other case (a cached text whose *regeneration* failed); this one covers
   * the first-ever run failing before any text was ever written. */

  errorWithoutText: string | null;
  onRegen: () => void;
}) {
  useTranslation();
  const isStale = entry
    ? stale(entry, hashContext(v, tile.ctx), i18n.resolvedLanguage ?? i18n.language)
    : false;
  const cls = [
    "gen-tile generated",
    run ? "running" : "",
    isStale ? "stale" : "",
    (entry?.err || errorWithoutText) && !run ? "failed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  let body: React.ReactNode;
  // The model answers in Markdown (the question asks it to, `run.ts`), and
  // the text is read with the same reader as the AI-Chat's answer rather than
  // drawn as one paragraph with its asterisks and backticks typed out.
  if (run) {
    body = run.text ? (
      <div className="gen-text gen-md" data-testid={`gen-text-${tile.id}`}>
        <Answer text={run.text} running />
      </div>
    ) : (
      <LoadTile tile={tile} run={run} />
    );
  } else if (entry?.text) {
    body = (
      <div className="gen-text gen-md" data-testid={`gen-text-${tile.id}`}>
        <Answer text={entry.text} running={false} />
      </div>
    );
  } else if (errorWithoutText) {
    body = (
      <div className="gen-fail">
        <span className="gen-kind">{tx("ui.generative.tile-failed")}</span>
        <span>{errorWithoutText}</span>
        <button
          type="button"
          className="t-btn t-btn--small"
          data-testid={`gen-retry-${tile.id}`}
          onClick={onRegen}
        >
          {tx("ui.generative.tile-retry")}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="gen-empty">
        <p className="gen-text">{tx("ui.generative.tile-no-text-yet")}</p>
        <p className="gen-request t-mono">{tile.request}</p>
        <button
          type="button"
          className="t-btn t-btn--small"
          data-testid={`gen-generate-${tile.id}`}
          onClick={onRegen}
        >
          {tx("ui.generative.tile-generate")}
        </button>
      </div>
    );
  }
  return (
    <article className={cls} data-testid={`gen-tile-${tile.id}`} data-tile={tile.id}>
      <header>
        <span className="gen-ttl">{tile.title}</span>
        <span className="gen-kind">
          {tx("ui.generative.tile-generated")} <i>⌁</i>
        </span>
        <button
          type="button"
          className="gen-re"
          data-testid={`gen-re-${tile.id}`}
          title={`${tile.request} — ${tx("ui.generative.tile-regenerate-generatedtile")}`}
          aria-label={tx("ui.generative.tile-regenerate")}
          disabled={Boolean(run)}
          onClick={onRegen}
        >
          {RE_ICON}
        </button>
      </header>
      <TileBody id={tile.id}>{body}</TileBody>
      <footer className="gen-src t-mono">
        <Origin tile={tile} entry={entry} v={v} />
      </footer>
    </article>
  );
}

export function MeasuredTile({ tile }: { tile: Extract<GenTile, { kind: "measured" }> }) {
  return (
    <article className="gen-tile measured" data-testid={`gen-tile-${tile.id}`} data-tile={tile.id}>
      <header>
        <span className="gen-ttl">{tile.title}</span>
        <span className="gen-kind">{tx("ui.generative.tile-measured")}</span>
      </header>
      <TileBody id={tile.id}>{tile.body}</TileBody>
      <footer className="gen-src t-mono">
        <span>{tx("ui.generative.tile-computed")}</span>
        <span>{tile.basis}</span>
      </footer>
    </article>
  );
}
