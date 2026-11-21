/**
 * An embed — a living view over the run, in the middle of the prose.
 *
 * The embed uses a `figure` with a hairline and a
 * surface panel, an optional title on top, and below it the provenance line
 * `COMPONENT · selector · from the run at HH:MM` in mono on the base colour.
 * Inside it the **existing visual language** — ledger rows, GWT, knowledge
 * slots, ring, tiles —, and that is why eight embeds on one page stay calm:
 * every one carries the same shell, and the running prose between them keeps
 * its authority.
 *
 * **The provenance line is the most important line in this whole file.** All
 * around it somebody has written; here stands something measured. Rule 3 of
 * the build code demands throughout Atlas that a measurement carries its
 * provenance, and on a wiki page it holds more strictly than elsewhere. That
 * is why the line names the run's time of day — and says so when the host
 * sent none, rather than inventing one.
 *
 * The three non-states (the specification) look different because they say different
 * things: **empty** is a measurement that found nothing, and stands as an
 * italic sentence *inside* the figure; **does not resolve** is a finding and
 * stands as a dead block with a red border; **not embeddable** is a rule, and
 * there the fenced block stays a fenced block with a line beneath it.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */

import { Component, type ReactNode } from "react";
import { tx } from "@/i18n";
import { sharePercent } from "@/share";
import { useVerbs } from "../verbs";
import {
  DevTag,
  num,
  short,
  type DerivedFeature,
  type DerivedModel,
  type DerivedScenario,
} from "../../../../frontend/src/plugin/components";
import {
  resolveEmbed,
  type EmbedPick,
  type Corpus,
  type WikiEmbed,
} from "./citations";

/**
 * An embed, with a boundary around it.
 *
 * Fifteen render paths, fed from **page-written** selectors over
 * **host-delivered** records: this is the one place in this surface where an
 * unexpected value can arrive from two directions at once. Without a
 * boundary a throw here takes the whole reader down with it — a paragraph of
 * prose disables Atlas.
 *
 * The throw is drawn in the shape that already exists for exactly this: the
 * dead block with its own YAML. It says what the author wrote, and that the
 * reader failed on it — never a gap where a measurement should have stood.
 */
export default function Embed({ yaml, k }: { yaml: string; k: Corpus }) {
  return (
    <Boundary yaml={yaml}>
      <Figure yaml={yaml} k={k} />
    </Boundary>
  );
}

class Boundary extends Component<
  { yaml: string; children: ReactNode },
  { errorState: string | null }
> {
  state: { errorState: string | null } = { errorState: null };

  static getDerivedStateFromError(error: unknown) {
    return {
      errorState: error instanceof Error ? error.message : String(error),
    };
  }

  render() {
    if (this.state.errorState === null) return this.props.children;
    return (
      <Dead
        e={{
          dead: true,
          yaml: this.props.yaml,
          why: tx("ui.wiki-src-wiki.embed-embed-could-not-drawn-reason", {
            reason: this.state.errorState,
          }),
          key: null,
          fence: false,
        }}
      />
    );
  }
}

function Figure({ yaml, k }: { yaml: string; k: Corpus }) {
  const e = resolveEmbed(yaml, k);
  if (e.dead) return <Dead e={e} />;

  return (
    <figure className="wiki-embed" data-testid="wiki-embed">
      {e.title ? (
        <figcaption
          className="wiki-embed__title"
          data-testid="wiki-embed-title"
        >
          {e.title}
        </figcaption>
      ) : null}
      <div className="wiki-embed__body" data-testid="wiki-embed-body">
        <Content e={e} />
      </div>
      {/*
       * Three pieces of information: what is shown, about what, and from
       * which run. The third is the one that distinguishes a measurement
       * from a sentence.
       */}
      <figcaption className="wiki-embed__cap" data-testid="wiki-embed-caption">
        <span>{e.component}</span>
        <span className="t-mono">{e.selector}</span>
        <span>{runState(k.v)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * When it was measured.
 *
 * Without a time, this states that the run reported none — not "00:00" and
 * not nothing at all. The time of day is the part of the line that dates the
 * measurement; where it is missing, that has to be said, otherwise the
 * figure reads like a finding without a point in time.
 */
function runState(v: DerivedModel): string {
  const at = v.scan.scannedAt;
  return at
    ? tx("ui.wiki-src-wiki.embed-run-time", {
        time: at.slice(11, 16),
      })
    : tx("ui.wiki-src-wiki.embed-run-reported-no-time");
}

/** The dead block and the fence left standing (the specification, cases 2 and 3). */
function Dead({ e }: { e: Extract<WikiEmbed, { dead: true }> }) {
  return (
    <figure
      className="wiki-embed"
      data-dead="true"
      data-fence={e.fence || undefined}
      data-testid="wiki-embed"
    >
      {/* Its own YAML stays visible — never a gap, never silently left out.
          It is what the author wrote. */}
      <pre className="wiki-embed__fence" data-testid="wiki-embed-dead-yaml">
        <code>{e.yaml}</code>
      </pre>
      <figcaption
        className="wiki-embed__cap t-bad"
        data-bad="true"
        data-testid="wiki-embed-caption"
      >
        {e.why}
      </figcaption>
    </figure>
  );
}

/** A sentence that says *what* is empty — never a zero (the specification case 1). */
const Empty = ({ children }: { children: ReactNode }) => (
  <div className="wiki-embed__empty t-muted" data-testid="wiki-embed-empty">
    {children}
  </div>
);

function Content({ e }: { e: Extract<WikiEmbed, { dead: false }> }) {
  switch (e.component) {
    case "ProofMatrix":
    case "ScenarioLedger":
      return <Ledger pick={e.pick} onlyGaps={e.onlyGaps} />;
    case "GherkinStatement":
      return <Gherkin pick={e.pick} />;
    case "KnowledgeSlots":
      return <Slots pick={e.pick} />;
    case "AnchorMap":
      return <Anchor pick={e.pick} />;
    case "Seal":
      return <SealView pick={e.pick} />;
    case "LifecycleBadge":
      return <Lifecycle pick={e.pick} />;
    case "RecordSource":
      return <Source pick={e.pick} />;
    case "DependencyFan":
      return <Slots2 pick={e.pick} />;
    case "Trail":
      return <Way pick={e.pick} />;
    case "CoverageRing":
      return <Ring pick={e.pick} />;
    case "GroupTiles":
      return <Tiles pick={e.pick} />;
    case "EntryCards":
      return <Cards pick={e.pick} />;
    case "Timeline":
      return <TimelineView pick={e.pick} />;
    case "TestPyramid":
      return <Pyramid pick={e.pick} />;
    case "EvidenceLedger":
      return <Evidence pick={e.pick} />;
  }
}

/**
 * The records an embed computes over.
 *
 * A `record:` selector is a list of one: the components that compute over a
 * set should not be written twice, just because once a record was chosen and
 * once a domain.
 */
function listOf(pick: EmbedPick): DerivedFeature[] {
  if (pick.over === "record") return [pick.f];
  if (pick.over === "promise") return [pick.f];
  if (pick.over === "list") return pick.list;
  return [];
}

/** The one record — for the components that have no question without it. */
function oneOf(pick: EmbedPick): DerivedFeature | null {
  return pick.over === "record" || pick.over === "promise" ? pick.f : null;
}

/* ── The components, in the visual language that already exists ── */

function Ledger({ pick, onlyGaps }: { pick: EmbedPick; onlyGaps: boolean }) {
  const verbs = useVerbs();
  const f = oneOf(pick);
  if (!f) return null;
  // Deviations do not stand in the quota (the specification) and therefore not in a
  // list that shows commitments either — their own mark stands next to them,
  // where they are asked for.
  const rows = f.scen.filter(
    (s) => s.state !== "dev" && (!onlyGaps || s.state !== "ok"),
  );

  if (!rows.length) {
    return (
      <Empty>
        {onlyGaps
          ? tx("ui.wiki-src-wiki.embed-test-names-every-promise-record")
          : tx("ui.wiki-src-wiki.embed-record-has-no-promise")}
      </Empty>
    );
  }

  return (
    <div className="wiki-embed__ledger">
      {rows.map((s) => (
        <button
          key={s.id}
          type="button"
          className="wiki-embed__lrow"
          data-testid="wiki-ledger-row"
          onClick={() => verbs.openScenario(f.id, s.id)}
        >
          <span className="wiki-embed__dot" data-state={s.state} />
          <span>
            <span className="wiki-embed__sid t-mono">
              {s.id}
              {s.deviation ? <DevTag /> : null}
            </span>
            <span className="wiki-embed__ev">
              {s.evidence === "ok" ? (
                <>
                  <span className="t-ok">
                    {tx("ui.wiki-src-wiki.embed-named-test")}
                  </span>
                  {s.test ? ` · ${s.test}` : ""}
                </>
              ) : s.evidence === "un" ? (
                <span className="t-warn t-mono">backing.state: unbacked</span>
              ) : (
                tx("ui.wiki-src-wiki.embed-no-test-names-promise")
              )}
            </span>
          </span>
          <span className="t-muted">›</span>
        </button>
      ))}
    </div>
  );
}

function Gherkin({ pick }: { pick: EmbedPick }) {
  // `GherkinStatement` only takes `promise:` (the specification), and `resolveEmbed`
  // rejects everything else as a dead block — **before** anything is drawn
  // here. Show an empty state for a rejected embed.
  // i.e. as a living figure with a provenance line: a "measurement" that
  // never took place, in the shape of the state "resolved and empty".
  if (pick.over !== "promise") return null;
  const s: DerivedScenario = pick.s;
  return (
    <div className="wiki-embed__gwt" data-testid="wiki-gherkin">
      {(
        [
          ["Given", s.given],
          ["When", s.when],
          ["Then", s.then],
        ] as const
      ).map(([label, text]) => (
        <div key={label}>
          <b>{label}</b>
          <p>{text || "—"}</p>
        </div>
      ))}
    </div>
  );
}

function Slots({ pick }: { pick: EmbedPick }) {
  const f = oneOf(pick);
  if (!f) return null;
  if (!f.know.length) {
    // Two different nothings: no block, or a block without answers. The
    // slots are owner-filled — "empty" never means "the answer is none".
    return (
      <Empty>
        {f.rec.knowledge.length
          ? tx("ui.wiki-src-wiki.embed-knowledge-slots-record-there-unfilled")
          : tx("ui.wiki-src-wiki.embed-record-has-no-knowledge-block")}
      </Empty>
    );
  }
  return (
    <div className="wiki-embed__defs">
      {f.know.map((slot) => (
        <div key={slot.key} data-testid="wiki-knowledge-slot">
          <p className="t-label">{slot.question || slot.key}</p>
          <p className="wiki-embed__a">{slot.answer ?? ""}</p>
        </div>
      ))}
    </div>
  );
}

function Anchor({ pick }: { pick: EmbedPick }) {
  const f = oneOf(pick);
  if (!f) return null;
  if (!f.anchors.length)
    return (
      <Empty>
        {tx("ui.wiki-src-wiki.embed-no-anchor-source-points-record")}
      </Empty>
    );
  return (
    <div className="wiki-kv">
      {f.anchors.map((a) => (
        <div key={`${a.path}:${a.line}`}>
          <span>
            <span className="wiki-kv__t">
              {a.path}:{a.line}
            </span>
            <span className="wiki-kv__d">{a.excerpt ?? ""}</span>
          </span>
          <span className="wiki-kv__r">{a.role}</span>
        </div>
      ))}
    </div>
  );
}

function SealView({ pick }: { pick: EmbedPick }) {
  const f = oneOf(pick);
  if (!f) return null;
  // Covered means: the record has something standing there. No judgement on
  // whether it is good — that would be a grade, and `facet lint` hands none
  // out.
  //
  // `defects` via `present` and not via the count of entries: the field
  // exists exactly for this. A kept ledger with no entry means "somebody
  // looked here and found nothing"; no ledger means "nobody has looked
  // here". Showing both as "missing" throws together the two statements
  // this whole cut keeps apart.
  const facets: [string, boolean][] = [
    ["intent", Boolean(f.summary)],
    ["contract", f.scen.length > 0],
    ["verification", f.proven > 0],
    ["knowledge", f.hasKnow],
    ["observation", f.obs !== null],
    ["lineage", Boolean(f.created || f.team)],
    ["defects", f.rec.defects.present],
  ];
  return (
    <div className="wiki-embed__seal" data-testid="wiki-seal">
      {facets.map(([name, have]) => (
        <span
          key={name}
          className={have ? "t-ok" : "t-muted"}
          data-have={have || undefined}
          data-testid="wiki-seal-facet"
        >
          {name}
        </span>
      ))}
    </div>
  );
}

function Lifecycle({ pick }: { pick: EmbedPick }) {
  const f = oneOf(pick);
  if (!f) return null;
  return (
    <span className="wiki-embed__state" data-life={f.life}>
      {f.life}
    </span>
  );
}

function Source({ pick }: { pick: EmbedPick }) {
  const f = oneOf(pick);
  if (!f) return null;
  // The file itself, not a version rebuilt from its fields: whoever looks
  // here wants to know what *stands* in the record.
  return (
    <pre className="wiki-embed__src t-mono" data-testid="wiki-record-source">
      {f.rec.raw}
    </pre>
  );
}

function Slots2({ pick }: { pick: EmbedPick }) {
  const verbs = useVerbs();
  const f = oneOf(pick);
  if (!f) return null;
  const deps = f.deps.filter((d) => d && d !== "—");
  if (!deps.length && !f.usedBy.length) {
    return (
      <Empty>
        {tx("ui.wiki-src-wiki.embed-record-names-no-prerequisite-none-depends")}
      </Empty>
    );
  }
  const col = (list: string[], dir: "in" | "out") =>
    list.map((id) => (
      <button
        key={`${dir}:${id}`}
        type="button"
        className="t-d-linkbtn"
        onClick={() => verbs.open(id)}
      >
        {dir === "in" ? "↳ " : "↦ "}
        {short(id)}
      </button>
    ));
  return (
    <div className="wiki-embed__fan">
      <div className="wiki-embed__col">{col(deps, "in")}</div>
      <div className="wiki-embed__mid" />
      <div className="wiki-embed__col">
        <span className="wiki-embed__self t-mono">{short(f.id)}</span>
        {col(f.usedBy, "out")}
      </div>
    </div>
  );
}

function Way({ pick }: { pick: EmbedPick }) {
  const verbs = useVerbs();
  const f = oneOf(pick);
  if (!f) return null;
  const first = f.scen[0];
  return (
    <div className="wiki-embed__trail">
      <button type="button" onClick={() => verbs.go(0)}>
        {tx("ui.wiki-src-wiki.embed-registry")}
      </button>
      <i>›</i>
      <button type="button" onClick={() => verbs.open(f.id)}>
        {short(f.id)}
      </button>
      {first ? (
        <>
          <i>›</i>
          <button
            type="button"
            onClick={() => verbs.openScenario(f.id, first.id)}
          >
            {first.id}
          </button>
        </>
      ) : null}
    </div>
  );
}

function Ring({ pick }: { pick: EmbedPick }) {
  const list = listOf(pick);
  const claims = list.reduce((a, f) => a + f.claims, 0);
  const proven = list.reduce((a, f) => a + f.proven, 0);
  // No share without a denominator — the same rule the progress bar in the
  // `enumerate` phase follows, and one of the example pages explains it
  // specifically.
  if (!claims) {
    return (
      <Empty>
        {list.length
          ? tx("ui.wiki-src-wiki.embed-selection-has-no-promise-could-counted")
          : tx("ui.wiki-src-wiki.embed-selection-contains-no-record")}
      </Empty>
    );
  }
  const r = 15;
  const c = 2 * Math.PI * r;
  const done = (c * proven) / claims;
  return (
    <div className="wiki-embed__cov" data-testid="wiki-coverage-ring">
      <svg className="wiki-embed__ring" viewBox="0 0 36 36" aria-hidden="true">
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="var(--facet-border)"
          strokeWidth="3"
        />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="var(--ok)"
          strokeWidth="3"
          strokeDasharray={`${done.toFixed(1)} ${c.toFixed(1)}`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <div>
        <p className="wiki-embed__n" data-testid="wiki-coverage-ring-percent">
          {sharePercent(proven, claims) ?? 0} %
        </p>
        <p className="t-meta" data-testid="wiki-coverage-ring-label">
          {/* Fraction form as in the design: sidesteps the agreement that
              would go wrong at exactly one commitment. */}
          {tx("ui.wiki-src-wiki.embed-proven-claims-named-test", {
            proven,
            claims,
          })}{" "}
          · {tx("ui.wiki-src-wiki.embed-count-records", { count: list.length })}
        </p>
      </div>
    </div>
  );
}

function Tiles({ pick }: { pick: EmbedPick }) {
  const verbs = useVerbs();
  const list = listOf(pick);
  if (!list.length)
    return (
      <Empty>{tx("ui.wiki-src-wiki.embed-selection-contains-no-record")}</Empty>
    );
  // Grouped by `domain/capability` — the same level at which the catalogue
  // cuts its tiles.
  const groups = new Map<string, DerivedFeature[]>();
  for (const f of list) {
    const key = f.id.split("/").slice(0, 2).join("/");
    const got = groups.get(key);
    if (got) got.push(f);
    else groups.set(key, [f]);
  }
  return (
    <div className="wiki-embed__tiles">
      {[...groups.entries()].map(([key, group]) => {
        const claims = group.reduce((a, f) => a + f.claims, 0);
        const proven = group.reduce((a, f) => a + f.proven, 0);
        return (
          <button
            key={key}
            type="button"
            className="wiki-embed__tile"
            data-testid="wiki-tile"
            onClick={() => verbs.open(group[0].id)}
          >
            <span className="wiki-embed__n">{group.length}</span>
            <span className="wiki-kv__t">{key}</span>
            <span className="t-meta">
              {/* Where there is no commitment, no quota stands — not "0 of 0". */}
              {claims
                ? tx("ui.wiki-src-wiki.embed-proven-claims-named-test", {
                    proven,
                    claims,
                  })
                : tx("ui.wiki-src-wiki.embed-no-promise")}{" "}
              ·{" "}
              {tx("ui.wiki-src-wiki.embed-count-drift", {
                count: group.filter((f) => f.driftN).length,
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Cards({ pick }: { pick: EmbedPick }) {
  const verbs = useVerbs();
  const list = listOf(pick);
  if (!list.length)
    return <Empty>{tx("ui.wiki-src-wiki.embed-no-record-selection")}</Empty>;
  return (
    <div className="wiki-embed__tiles">
      {list.slice(0, 6).map((f) => (
        <button
          key={f.id}
          type="button"
          className="wiki-embed__tile"
          onClick={() => verbs.open(f.id)}
        >
          <span className="wiki-kv__t">{short(f.id)}</span>
          <span className="t-meta">{f.summary.split("\n")[0]}</span>
        </button>
      ))}
    </div>
  );
}

function TimelineView({ pick }: { pick: EmbedPick }) {
  const verbs = useVerbs();
  const list = listOf(pick);
  const fixes = list
    .flatMap((f) => f.fixes.map((x) => ({ f, x })))
    .sort((a, b) => b.x.date.localeCompare(a.x.date));
  if (!fixes.length) {
    return (
      <Empty>
        {list.length === 1
          ? tx("ui.wiki-src-wiki.embed-no-bugfix-commit-names-record")
          : tx(
              "ui.wiki-src-wiki.embed-no-bugfix-commit-names-record-selection",
            )}
      </Empty>
    );
  }
  return (
    <div className="wiki-embed__timeline">
      {fixes.slice(0, 8).map(({ f, x }) => (
        <button
          key={`${f.id}:${x.commit}`}
          type="button"
          data-testid="wiki-timeline-entry"
          onClick={() => verbs.open(f.id)}
        >
          <span className="wiki-kv__t">
            {short(f.id)} — {x.subject}
          </span>
          <span className="wiki-kv__d">{x.date}</span>
        </button>
      ))}
    </div>
  );
}

function Pyramid({ pick }: { pick: EmbedPick }) {
  const list = listOf(pick);
  // Counted over **all** tests of every commitment and not just the first:
  // a registry often names several, and grouping by the first would lose
  // every file named second — a measured number that is too small, and
  // nobody can tell it is incomplete.
  const kinds = new Map<string, Set<string>>();
  for (const f of list) {
    for (const s of f.scen) {
      for (const t of s.raw.tests) {
        const got = kinds.get(t.kind) ?? new Set<string>();
        got.add(t.id);
        kinds.set(t.kind, got);
      }
    }
  }
  if (!kinds.size)
    return (
      <Empty>
        {tx("ui.wiki-src-wiki.embed-no-test-selection-names-promise-name")}
      </Empty>
    );
  const rows = [...kinds.entries()].map(
    ([kind, files]) => [kind, files.size] as const,
  );
  const max = Math.max(...rows.map(([, n]) => n));
  return (
    <div className="wiki-embed__bars">
      {rows.map(([kind, n]) => (
        <span
          key={kind}
          className="wiki-embed__row"
          data-testid="wiki-pyramid-row"
        >
          <span>{kind}</span>
          <span className="wiki-embed__track">
            <i style={{ width: `${(n / max) * 100}%` }} />
          </span>
          <span>{num(n)}</span>
        </span>
      ))}
    </div>
  );
}

function Evidence({ pick }: { pick: EmbedPick }) {
  const verbs = useVerbs();
  // As with `Gherkin`: `EvidenceLedger` only takes `assumption:`, and the
  // rejection stands in `resolveEmbed` as a dead block — not here as an
  // empty figure with a provenance line.
  if (pick.over !== "assumption") return null;
  return (
    <>
      <p className="wiki-embed__verdict">{pick.rule}</p>
      {pick.features.length ? (
        <div className="wiki-kv">
          {pick.features.map((id) => (
            <div key={id}>
              <span>
                <span className="wiki-kv__t">
                  <button
                    type="button"
                    className="t-d-linkbtn"
                    onClick={() => verbs.open(id)}
                  >
                    {short(id)}
                  </button>
                </span>
              </span>
              <span className="wiki-kv__r">
                {tx("ui.wiki-src-wiki.embed-relies")}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Empty>
          {tx("ui.wiki-src-wiki.embed-no-record-relies-assumption")}
        </Empty>
      )}
    </>
  );
}
