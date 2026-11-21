import { tx } from "../../../../frontend/src/i18n";
/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { areaRow, ghostsAt, ghostsIn, type Area, type Ghost } from "./tree";
import type { HostConnection, HostState } from "./host";
import { help as helpTexts } from "./help";
import {
  select,
  release,
  numberOf,
  connectionOf,
  selectable,
  mapSelection,
  type Selection,
  type Side,
  type Target,
  type Mapping,
} from "./mapping";
import { check, stateText, type Reach } from "./state";
import "../wiki.css";
/**
 * The three modes, with the sentence saying who wins.
 *
 * ↔ is among them and is **not a merge**: the engine cannot do it, and the
 * surface does not claim it. It offers a proposal branch — there is no second
 * merge beside git.
 */
function modes(): [string, string, string][] {
  return [
    [
      "a2c",
      tx("ui.wiki-src-confluence.confluence-atlas-confluence"),
      tx("ui.wiki-src-confluence.confluence-wiki-origin-conflicts-reported"),
    ],
    [
      "c2a",
      tx("ui.wiki-src-confluence.confluence-confluence-atlas"),
      tx("ui.wiki-src-confluence.confluence-import-pull-request"),
    ],
    [
      "bidi",
      tx("ui.wiki-src-confluence.confluence-atlas-confluence-modes"),
      tx(
        "ui.wiki-src-confluence.confluence-both-ways-proposal-branch-never-merge",
      ),
    ],
  ];
}
export default function Confluence({
  state,
  onDismiss,
  fetchState,
}: {
  state: HostState;
  onDismiss: () => void;
  /**
   * Injectable for tests — otherwise the surface asks the host itself.
   *
   * Without a default value, and that is no oversight: `holen = fetch` is
   * evaluated at render time, and in an environment without a global `fetch`
   * the very first mount of the surface throws. So the default sits at the
   * call site, where it is only needed once a request is really made.
   */
  fetchState?: typeof fetch;
}) {
  const [sel, setSel] = useState<Selection>(null);
  const [maps, setMaps] = useState<Mapping[]>([]);
  const [mode, setMode] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [help, setHelp] = useState(false);
  const [moment, setMoment] = useState<string | null>(null);
  const [ownState, setOwnState] = useState<Reach[]>([]);
  const [checkingState, setCheckingState] = useState(false);
  // The lock lives in a ref and not in state: with two clicks in the same
  // pass, `disabled` is absent from the button at the second one, and the claim
  // "exactly one request" would be broken before React has re-rendered.
  const runningState = useRef(false);
  const [dragged, setDragged] = useState<Side | null>(null);
  const conns = state.connections;
  const reaches = useMemo(
    () => [...ownState, ...state.reaches],
    [ownState, state.reaches],
  );
  const text = useMemo(
    () => stateText({ ...state, reaches }),
    [state, reaches],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      // The Esc ladder: first the dialog, then the moment, then the surface.
      // Whoever presses Esc means whatever is on top.
      if (help) return setHelp(false);
      if (moment) return setMoment(null);
      onDismiss();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [help, moment, onDismiss]);
  const choose = useCallback(
    (side: Side, id: string) => setSel((v) => select(v, side, id, maps, conns)),
    [maps, conns],
  );
  const place = useCallback(
    (onSide: Side, target: Target) => {
      setMaps((v) => {
        const nextItems = mapSelection(v, sel, target, onSide);
        if (nextItems !== v) setSel(null);
        return nextItems;
      });
      setDragged(null);
    },
    [sel],
  );
  const checkNow = useCallback(async () => {
    if (runningState.current) return;
    runningState.current = true;
    setCheckingState(true);
    try {
      const e = await check(fetchState ?? fetch);
      setOwnState((v) => [e, ...v]);
    } finally {
      runningState.current = false;
      setCheckingState(false);
    }
  }, [fetchState]);
  const momentConn = moment ? conns.find((c) => c.area === moment) : null;
  if (momentConn) {
    return <Moment conn={momentConn} onLater={() => setMoment(null)} />;
  }
  return (
    <section className="confl" id="confl">
      <div className="confl-head">
        <nav
          className="crumbk"
          aria-label={tx("ui.wiki-src-confluence.confluence-set-up-confluence")}
        >
          <button type="button" onClick={onDismiss}>
            {tx("ui.wiki-src-confluence.confluence-settings")}
          </button>
          <span className="sep">/</span>
          <button type="button" onClick={onDismiss}>
            {tx("ui.wiki-src-confluence.confluence-documentation")}
          </button>
          <span className="sep">/</span>
          <span className="now">
            {tx("ui.wiki-src-confluence.confluence-set-up-confluence")}
          </span>
        </nav>
        <span className="n">
          {tx("ui.wiki-src-confluence.confluence-count-connections", {
            count: conns.length,
          })}
        </span>
        <button
          type="button"
          className="t-btn t-btn--small t-btn--quiet"
          onClick={() => setHelp(true)}
        >
          {tx("ui.wiki-src-confluence.confluence-how-does-work")}
        </button>
        <button
          type="button"
          className="t-btn t-btn--small closeview"
          title={tx("ui.wiki-src-confluence.confluence-close-confluence")}
          onClick={onDismiss}
        >
          {tx("ui.wiki-src-confluence.confluence-esc-close")}
        </button>
      </div>

      <div className="cbody">
        {/* The status line — no field, no form, no "Connected". */}
        <div className="statebar">
          <span>{text.token}</span>
          <span>{text.instance}</span>
          <span className={text.ok ? "t-ok" : "t-bad"}>{text.answered}</span>
          {text.previous ? (
            <span className="t-bad">{text.previous}</span>
          ) : null}
          <button
            type="button"
            className="t-btn t-btn--small"
            onClick={checkNow}
            disabled={checkingState}
          >
            {checkingState
              ? tx("ui.wiki-src-confluence.confluence-checking")
              : tx("ui.wiki-src-confluence.confluence-check-now")}
          </button>
        </div>

        <div className="cfull">
          <div className="two">
            <WikiTree
              areas={state.areas}
              sel={sel}
              maps={maps}
              conns={conns}
              dragged={dragged}
              onChoose={(id) => choose("wiki", id)}
              onDrag={() => setDragged("wiki")}
              onPlace={place}
              onMoment={setMoment}
            />

            <Middle
              sel={sel}
              maps={maps}
              mode={mode}
              onMode={setMode}
              onRelease={(n) => setMaps((v) => release(v, n))}
              onClear={() => setSel(null)}
            />

            <ConfTree
              q={q}
              onQ={setQ}
              spaces={text.spaces}
              sel={sel}
              maps={maps}
              conns={conns}
              areas={state.areas}
              dragged={dragged}
              onChoose={(id) => choose("conf", id)}
              onDrag={() => setDragged("conf")}
              onPlace={place}
            />
          </div>
        </div>
      </div>

      {help ? <Help onDismiss={() => setHelp(false)} /> : null}
    </section>
  );
}
/* ── Left: the wiki ── */
function WikiTree({
  areas,
  sel,
  maps,
  conns,
  dragged,
  onChoose,
  onDrag,
  onPlace,
  onMoment,
}: {
  areas: Area[];
  sel: Selection;
  maps: Mapping[];
  conns: HostConnection[];
  dragged: Side | null;
  onChoose: (id: string) => void;
  onDrag: () => void;
  onPlace: (side: Side, target: Target) => void;
  onMoment: (area: string) => void;
}) {
  const target = sel !== null && sel.side === "conf";
  return (
    <div className={`pane2 ${target ? "target" : ""}`}>
      <div className="ph">
        <p className="k">{tx("ui.wiki-src-confluence.confluence-wiki")}</p>
        <span className="n">
          {tx("ui.wiki-src-confluence.confluence-count-areas", {
            count: areas.length,
          })}
        </span>
      </div>
      <div className="pf">
        <input
          className="sin"
          placeholder={tx("ui.wiki-src-confluence.confluence-filter-areas")}
          disabled
        />
        {sel && sel.side === "wiki" ? (
          <span className="selcount">
            {sel.ids.length} {tx("ui.wiki-src-confluence.confluence-chosen")}
          </span>
        ) : null}
      </div>
      <div className="ctree">
        {areas.map((b, i) => (
          <AreaLine
            key={b.id}
            b={b}
            before={i ? areas[i - 1].id : ""}
            sel={sel}
            maps={maps}
            conns={conns}
            areas={areas}
            target={target}
            dragged={dragged}
            onChoose={onChoose}
            onDrag={onDrag}
            onPlace={onPlace}
            onMoment={onMoment}
          />
        ))}
        {/* The gap after the last row — otherwise there would be no "at the very bottom". */}
        <Gap
          side="wiki"
          parent=""
          after={areas.length ? areas[areas.length - 1].id : ""}
          activeState={target && dragged === "conf"}
          maps={maps}
          areas={areas}
          onPlace={onPlace}
        />
      </div>
    </div>
  );
}
function AreaLine({
  b,
  before,
  sel,
  maps,
  conns,
  areas,
  target,
  dragged,
  onChoose,
  onDrag,
  onPlace,
  onMoment,
}: {
  b: Area;
  before: string;
  sel: Selection;
  maps: Mapping[];
  conns: HostConnection[];
  areas: Area[];
  target: boolean;
  dragged: Side | null;
  onChoose: (id: string) => void;
  onDrag: () => void;
  onPlace: (side: Side, target: Target) => void;
  onMoment: (area: string) => void;
}) {
  const z = areaRow(b);
  const n = numberOf("wiki", b.id, maps);
  const cn = connectionOf("wiki", b.id, conns) as HostConnection | null;
  const chosen = Boolean(sel && sel.side === "wiki" && sel.ids.includes(b.id));
  const available = selectable("wiki", b.id, maps, conns);
  return (
    <>
      <Gap
        side="wiki"
        parent=""
        after={before}
        activeState={target && dragged === "conf"}
        maps={maps}
        areas={areas}
        onPlace={onPlace}
      />
      <button
        type="button"
        className={[
          "tr",
          chosen ? "sel" : "",
          n !== null ? "mapped" : "",
          cn
            ? `fixed linked ${cn.kind === "origin" ? "origin" : cn.kind === "copy" ? "copy" : "open"}`
            : "",
          target ? "drop" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        // The origin is shown on the row: a connection that only appears as a
        // green edge is an assertion without a source.
        title={
          cn
            ? tx("ui.wiki-src-confluence.confluence-read-source", {
                source: cn.evidence,
              })
            : undefined
        }
        aria-pressed={chosen}
        draggable={chosen}
        onDragStart={onDrag}
        onDragOver={(e) => {
          if (dragged === "conf" && available) e.preventDefault();
        }}
        onDrop={() => onPlace("wiki", { kind: "onto", id: b.id })}
        onClick={() => onChoose(b.id)}
      >
        <span className="pick">{chosen ? "✓" : ""}</span>
        <span className="t">
          {z.title ? <b>{z.title}</b> : null}{" "}
          <span
            className="t-mono"
            data-testid="tree-folder-path"
            style={{ color: z.mono ? "var(--t-bad)" : "var(--t-muted)" }}
          >
            {z.folder}
          </span>
        </span>
        <span className="c">
          {n !== null ? <span className="mnum">{n}</span> : null}
          {cn ? (
            <span
              className={`mark ${cn.kind === "origin" ? "origin" : cn.kind === "copy" ? "copy" : "none"}`}
            >
              {cn.kind === "origin"
                ? tx("ui.wiki-src-confluence.confluence-origin-target", {
                    target: cn.target,
                  })
                : cn.kind === "copy"
                  ? tx("ui.wiki-src-confluence.confluence-copy-target", {
                      target: cn.target,
                    })
                  : tx("ui.wiki-src-confluence.confluence-choice-open-target", {
                      target: cn.target,
                    })}
            </span>
          ) : null}
          {z.countLabel}
        </span>
      </button>
      {/*
       * "Make a choice" stands BESIDE the row and not inside it. Inside it was a
       * button inside a button — invalid HTML, and the row's name swallowed the
       * button's, so both answered to the same label.
       */}
      {cn && cn.kind === "open" ? (
        <div className="trnote">
          <button
            type="button"
            className="klink"
            onClick={() => onMoment(b.id)}
          >
            {tx("ui.wiki-src-confluence.confluence-make-choice")}
          </button>
        </div>
      ) : null}
      <Ghosts ghosts={ghostsAt("wiki", b.id, maps, areas)} />
    </>
  );
}
/* ── Right: Confluence ── */
function ConfTree({
  q,
  onQ,
  spaces,
  sel,
  maps,
  conns,
  areas,
  dragged,
  onChoose,
  onDrag,
  onPlace,
}: {
  q: string;
  onQ: (next: string) => void;
  spaces: string | null;
  sel: Selection;
  maps: Mapping[];
  conns: HostConnection[];
  areas: Area[];
  dragged: Side | null;
  onChoose: (id: string) => void;
  onDrag: () => void;
  onPlace: (side: Side, target: Target) => void;
}) {
  const target = sel !== null && sel.side === "wiki";
  const search = q.trim().toUpperCase();
  // The spaces that are already connected are the only ones this surface
  // knows by itself — they stand in the host's connections. There is no list
  // of all spaces: "400 spaces" comes from an answer, and so does every other
  // count.

  const known = [...new Set(conns.map((c) => c.target.split("/")[0]))];
  const match = search ? known.filter((k) => k.includes(search)) : [];
  return (
    <div className={`pane2 r ${target ? "target" : ""}`}>
      <div className="ph">
        <p className="k">
          {tx("ui.wiki-src-confluence.confluence-confluence")}
        </p>
        <span className="n">
          {spaces ??
            tx("ui.wiki-src-confluence.confluence-spaces-through-search")}
        </span>
      </div>
      <div className="pf">
        <input
          id="confq"
          className="sin"
          placeholder={tx(
            "ui.wiki-src-confluence.confluence-search-space-conftree",
          )}
          value={q}
          autoComplete="off"
          spellCheck={false}
          aria-label={tx("ui.wiki-src-confluence.confluence-search-space")}
          onChange={(e) => onQ(e.target.value)}
        />
        {sel && sel.side === "conf" ? (
          <span className="selcount">
            {tx("ui.wiki-src-confluence.confluence-1-chosen")}
          </span>
        ) : null}
      </div>
      <div className="ctree">
        {!search ? (
          <div className="crecent">
            <p className="k">
              {tx("ui.wiki-src-confluence.confluence-already-connected")}
            </p>
            {known.length ? (
              known.map((k) => (
                <button
                  key={k}
                  type="button"
                  className="klink"
                  onClick={() => onQ(k)}
                >
                  {k}
                </button>
              ))
            ) : (
              <span className="t-mono t-muted">
                {tx("ui.wiki-src-confluence.confluence-no")}
              </span>
            )}
          </div>
        ) : match.length ? (
          match.map((k, i) => (
            <SpaceRow
              key={k}
              id={k}
              before={i ? match[i - 1] : ""}
              sel={sel}
              maps={maps}
              conns={conns}
              areas={areas}
              target={target}
              dragged={dragged}
              onChoose={onChoose}
              onDrag={onDrag}
              onPlace={onPlace}
            />
          ))
        ) : (
          <div className="emptybox">
            {tx("ui.wiki-src-confluence.confluence-no-results")} {q}“
          </div>
        )}
      </div>
    </div>
  );
}
function SpaceRow({
  id,
  before,
  sel,
  maps,
  conns,
  areas,
  target,
  dragged,
  onChoose,
  onDrag,
  onPlace,
}: {
  id: string;
  before: string;
  sel: Selection;
  maps: Mapping[];
  conns: HostConnection[];
  areas: Area[];
  target: boolean;
  dragged: Side | null;
  onChoose: (id: string) => void;
  onDrag: () => void;
  onPlace: (side: Side, target: Target) => void;
}) {
  const n = numberOf("conf", id, maps);
  const cn = connectionOf("conf", id, conns);
  const chosen = Boolean(sel && sel.side === "conf" && sel.ids.includes(id));
  const available = selectable("conf", id, maps, conns);
  return (
    <>
      <Gap
        side="conf"
        parent=""
        after={before}
        activeState={target && dragged === "wiki"}
        maps={maps}
        areas={areas}
        onPlace={onPlace}
      />
      <button
        type="button"
        className={[
          "tr",
          chosen ? "sel" : "",
          n !== null ? "mapped" : "",
          cn ? "fixed linked copy" : "",
          target ? "drop" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={
          cn
            ? tx("ui.wiki-src-confluence.confluence-read-source", {
                source: cn.evidence,
              })
            : undefined
        }
        aria-pressed={chosen}
        draggable={chosen}
        onDragStart={onDrag}
        onDragOver={(e) => {
          if (dragged === "wiki" && available) e.preventDefault();
        }}
        onDrop={() => onPlace("conf", { kind: "onto", id })}
        onClick={() => onChoose(id)}
      >
        <span className="tw" aria-hidden="true" />
        <span className="t">
          <b>{id}</b>
        </span>
        <span className="c">
          {n !== null ? <span className="mnum">{n}</span> : null}
          {tx("ui.wiki-src-confluence.confluence-space")}
        </span>
      </button>
      <Ghosts ghosts={ghostsAt("conf", id, maps, areas)} />
    </>
  );
}
/* ── The gap: "create new here" ── */
function Gap({
  side,
  parent,
  after,
  activeState,
  maps,
  areas,
  onPlace,
}: {
  side: Side;
  parent: string;
  after: string;
  activeState: boolean;
  maps: Mapping[];
  areas: Area[];
  onPlace: (side: Side, target: Target) => void;
}) {
  const ghosts = ghostsIn(side, parent, after, maps, areas);
  return (
    <>
      {ghosts.length ? <Ghosts ghosts={ghosts} /> : null}
      {activeState ? (
        <div
          className="dz"
          data-testid="confluence-insertion-drop-zone"
          // The gap only appears while dragging — dashed, as the draft draws it.
          // Without a drag it is 0 px high and in nothing's way.
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onPlace(side, { kind: "new", parent, after })}
        >
          <span>{tx("ui.wiki-src-confluence.confluence-create-new")}</span>
        </div>
      ) : null}
    </>
  );
}
function Ghosts({ ghosts }: { ghosts: Ghost[] }) {
  return (
    <>
      {ghosts.map((g, i) => (
        <div
          key={`${g.n}-${g.title}-${i}`}
          data-testid={`geist-${g.n}`}
          className={`tr cghost ${g.created ? "gen" : ""}`}
        >
          <span className="tw">▾</span>
          <span className="t">{g.title}</span>
          <span className="c">
            <span className="mnum">{g.n}</span>
            {g.reason}
          </span>
        </div>
      ))}
    </>
  );
}
/* ── The middle: state, mappings, mode ── */
function Middle({
  sel,
  maps,
  mode,
  onMode,
  onRelease,
  onClear,
}: {
  sel: Selection;
  maps: Mapping[];
  mode: string | null;
  onMode: (m: string) => void;
  onRelease: (n: number) => void;
  onClear: () => void;
}) {
  const chosen =
    mode ?? (maps[0] ? (maps[0].side === "wiki" ? "a2c" : "c2a") : null);
  return (
    <div className="mid">
      {!sel && !maps.length ? (
        <div className="mstate">
          <p className="k">{tx("ui.wiki-src-confluence.confluence-mapping")}</p>
          <p className="mhint">
            {tx(
              "ui.wiki-src-confluence.confluence-select-left-right-then-drag-other",
            )}
          </p>
        </div>
      ) : null}

      {sel ? (
        <div className="mstate pending">
          <p className="k">
            {tx("ui.wiki-src-confluence.confluence-selection")} {sel.ids.length}{" "}
            {sel.side === "wiki"
              ? tx("ui.wiki-src-confluence.confluence-areas", {
                  count: sel.ids.length,
                })
              : tx("ui.wiki-src-confluence.confluence-confluence-page")}
          </p>
          <p className="mhint">
            {tx(
              "ui.wiki-src-confluence.confluence-target-missing-drag-side-onto-row",
              {
                side:
                  sel.side === "wiki"
                    ? tx("ui.wiki-src-confluence.confluence-right")
                    : tx("ui.wiki-src-confluence.confluence-left"),
              },
            )}
          </p>
          <span className="arrow big">{sel.side === "wiki" ? "→" : "←"}</span>
          <button
            type="button"
            className="t-btn t-btn--small"
            onClick={onClear}
          >
            {tx("ui.wiki-src-confluence.confluence-clear-selection")}
          </button>
        </div>
      ) : null}

      {maps.length ? (
        <ul
          className="maps"
          aria-label={tx("ui.wiki-src-confluence.confluence-mappings-count", {
            count: maps.length,
          })}
        >
          {maps.map((m) => (
            <li className="map" key={m.n}>
              <span className="mnum">{m.n}</span>
              <span className="mpair">
                <span className="mp">
                  {m.ids.map((id) => `${id}/`).join(", ")}
                </span>
                <span className="arrow">{m.side === "wiki" ? "→" : "←"}</span>
                <span className={`mp ${m.target.kind === "new" ? "new" : ""}`}>
                  {m.target.kind === "onto"
                    ? m.target.id
                    : tx("ui.wiki-src-confluence.confluence-new-under-parent", {
                        parent:
                          m.target.parent ||
                          tx("ui.wiki-src-confluence.confluence-root"),
                      })}
                </span>
              </span>
              <button
                type="button"
                className="mx"
                title={tx("ui.wiki-src-confluence.confluence-remove-mapping")}
                aria-label={tx(
                  "ui.wiki-src-confluence.confluence-remove-mapping-n",
                  {
                    n: m.n,
                  },
                )}
                onClick={() => onRelease(m.n)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {maps.length ? (
        <div className="modes">
          {modes().map(([k, a, s]) => (
            <button
              type="button"
              key={k}
              className={chosen === k ? "on" : ""}
              aria-pressed={chosen === k}
              onClick={() => onMode(k)}
            >
              <span className="a">{a}</span>
              <span className="s">{s}</span>
            </button>
          ))}
        </div>
      ) : null}

      {maps.length ? (
        <p className="midnote">
          {/*
           * The run does NOT live on this surface. An import is a bulk write
           * onto a branch; the CLI owns that path with its worktree, its commit
           * and its pull request. A button here implementing it a second time
           * would be a second place for the same refusals — and a button that
           * only looks like one would be a claim this cut does not keep.
           */}
          <span className="t-mono">
            {chosen === "c2a"
              ? "facet wiki import confluence <ref>"
              : "facet wiki mirror --to=confluence --space=<KEY>"}
          </span>
        </p>
      ) : null}
    </div>
  );
}
function Moment({
  conn,
  onLater,
}: {
  conn: HostConnection;
  onLater: () => void;
}) {
  return (
    <section className="confl" id="confl">
      <article className="spage">
        <div className="loud">
          <p className="k">
            {tx("ui.wiki-src-confluence.confluence-import")} {conn.area}/ ←{" "}
            {conn.target}
          </p>
          <h3>
            {/*
             * The number comes from the connection — if it has none, none is
             * shown. "0 pages are in the wiki" would be a measurement
             * nobody made, and it would stand in the loudest sentence of the
             * whole surface, of all places.
             *
             * The sentence is built as ONE expression and not assembled from
             * pieces: otherwise it falls apart into three text nodes in the
             * DOM, and that is not only a question of testability — a screen
             * reader reads three scraps instead of one sentence.
             */}
            <span>
              {`${
                conn.pages == null
                  ? tx("ui.wiki-src-confluence.confluence-pages-target", {
                      target: conn.target,
                    })
                  : tx("ui.wiki-src-confluence.confluence-count-pages", {
                      count: conn.pages,
                    })
              } ${tx("ui.wiki-src-confluence.confluence-now-wiki")} `}
            </span>
            <b>
              {tx(
                "ui.wiki-src-confluence.confluence-confluence-knows-nothing-about",
              )}
            </b>
          </h3>
          <p>
            {tx("ui.wiki-src-confluence.confluence-which-side-applies-now")}
          </p>
          <div className="two">
            {/*
             * No preselection. Both buttons are drawn as equals, and neither
             * carries `on` or `aria-pressed` — "Choice open" is a real third
             * state and not a default one clicks away.
             */}
            <button type="button">
              <span className="t">
                {tx(
                  "ui.wiki-src-confluence.confluence-confluence-stays-origin",
                )}
              </span>
              <span className="s">
                {tx("ui.wiki-src-confluence.confluence-wiki-copy-import-again")}
              </span>
            </button>
            <button type="button">
              <span className="t">
                {tx("ui.wiki-src-confluence.confluence-wiki-becomes-origin")}
              </span>
              <span className="s">
                {tx("ui.wiki-src-confluence.confluence-confluence-copy-mirror")}
              </span>
            </button>
          </div>
          <p className="sfh">
            <button type="button" className="klink" onClick={onLater}>
              {tx("ui.wiki-src-confluence.confluence-decide-later")}
            </button>
            {` — ${tx("ui.wiki-src-confluence.confluence-choice-open-mark-stays")}`}
          </p>
        </div>
      </article>
    </section>
  );
}
/* ── The explanation, behind a dialog ── */
function Help({ onDismiss }: { onDismiss: () => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  // Without this focus it would stay on the button that opened the dialog —
  // then Esc would run on the surface underneath and close *that*.
  useEffect(() => {
    box.current?.focus();
  }, []);
  return (
    /*
     * The click on the backdrop closes — common, but without a keyboard path
     * it would be a door that only opens with the mouse. The linter is right
     * about that: `role="dialog"` counts as non-interactive, and a click
     * listener without a key listener excludes somebody.
     *
     * The key path was already there, though: the Esc ladder at document
     * level (above, `useEffect`) closes "first the dialog, then the moment,
     * then the surface". A second listener here would be a second place with
     * the same responsibility — and one that turns no assertion red, because
     * the ladder does the same without it. What was missing was the **focus**:
     * without it, it stays on the opening button, and the ladder runs
     * correctly, but a screen reader is still standing outside.
     */
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="wiki-help"
      id="cdialog"
      role="dialog"
      aria-modal="true"
      aria-label={tx("ui.wiki-src-confluence.confluence-how-does-work")}
      ref={box}
      tabIndex={-1}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className="wiki-help__box t-float">
        <header className="t-sheet__head">
          <span className="t-h3 wiki-help__title">
            {tx("ui.wiki-src-confluence.confluence-how-does-work")}
          </span>
          <button
            type="button"
            className="t-btn t-btn--small"
            onClick={onDismiss}
          >
            {tx("ui.wiki-src-confluence.confluence-close")}
          </button>
        </header>
        <div className="t-sheet__body wiki-help__text">
          {helpTexts().map(([title, sentence]) => (
            <p key={title}>
              <b>{title}</b> {sentence}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
