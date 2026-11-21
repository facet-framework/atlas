/** Group B places: the Records collection and a record's record. */

import { useRef, useState } from "react";
import { useSurfaceText as useText } from "@/screens/text";
import { records } from "@/screens";
import {
  RECORDS_DEFAULT,
  byAreaLabel,
  recordOf,
  nearestRecords,
  recordsProps,
  removeFilter,
  siblingsOf,
  toggleFacet,
  type RecordsQuery,
} from "../derive-reader";
import type { PageContext } from "../context";
import { href } from "../route";
import { loadCodeZoom, readSource, saveCodeZoom } from "../source";
import { knowledgePrompt } from "../knowledge-ask";
import { useStuck } from "../stuck";
import { lookupTarget, withDeclarations, type LookupRequest } from "../record-extras";
import { proseRenderer } from "../prose";

const SECTIONS: readonly records.RecordSectionKey[] = [
  "promises",
  "code",
  "knowledge",
  "drift",
  "history",
  "relations",
  "operations",
  "rules",
];

/** The section an address names, if it is one of the page's sections. */
function sectionOf(s: string | undefined): records.RecordSectionKey | undefined {
  return SECTIONS.find((k) => k === s);
}

// @facet: registry/records/record-browser
// @facet-role: primary
export function RecordsPlace({ ctx }: { ctx: PageContext }) {
  const [q, set] = ctx.slot<RecordsQuery>("records", RECORDS_DEFAULT);
  const neighbours = (id: string) => {
    const r = ctx.model.byId[id];
    return r ? r.dependsOn.length + r.dependedOnBy.length : 0;
  };
  const { focusId, lensHits, ...props } = recordsProps(ctx.rows, q, ctx.t, neighbours);
  return (
    <records.RecordsPage
      {...props}
      mobile={ctx.mobile}
      lens={{
        focus: focusId ? recordOf(ctx.model, focusId, ctx.overview.history, ctx.overview) : null,
        hits: lensHits,
        tab: q.lensTab,
        open: q.lensOpen,
      }}
      onFocus={(focus) => set({ focus, lensOpen: 0 })}
      onLensTab={(lensTab) => set({ lensTab })}
      onLensUnfold={(lensOpen) => set({ lensOpen })}
      onQuery={(query) => set({ query, page: 1 })}
      onView={(view) => set({ view })}
      onFacet={(key) => set({ filters: toggleFacet(q.filters, key), page: 1 })}
      onRemoveFilter={(key) => set({ filters: removeFilter(q.filters, key), page: 1 })}
      onReset={() => set({ query: "", filters: {}, page: 1 })}
      onSort={(key) =>
        set({
          sort: {
            key: key as RecordsQuery["sort"]["key"],
            dir: q.sort.key === key && q.sort.dir === "asc" ? "desc" : "asc",
          },
          page: 1,
        })
      }
      onPage={(page) => set({ page })}
      onPageSize={(pageSize) => set({ pageSize, page: 1 })}
      onOpen={(id) => ctx.go(href({ area: "record", id }))}
      onCell={(domain, capability, lifecycle) =>
        set({
          filters: { ...q.filters, domain, lifecycle },
          query: capability,
          view: "list",
          page: 1,
        })
      }
      onDistribution={(band, key) =>
        set({
          filters:
            band === byAreaLabel(ctx.t)
              ? toggleFacet(q.filters, `domain:${key}`)
              : toggleFacet(q.filters, `lc:${key}`),
          page: 1,
        })
      }
    />
  );
}

type RecordState = {
  tab: "record" | "raw";
  rawFormat: "yaml" | "json";
  collapsed: records.RecordSectionKey[];
  scenarioFilter: "all" | "open" | "proven";
  /** The readership selection; absent in a state stored before it existed. */
  audienceFilter?: records.RecordAudienceFilter;
  /** A term or record looked up beside the page; it stays with the record it was opened on. */
  lookup: (LookupRequest & { on: string }) | null;
};

/** A record's page: its record with the declarations read from the record,
 * prose drawn with markup and terms, and a lookup beside it. */

// @facet: registry/records/promise-evidence
// @facet-role: primary
// @facet: registry/records/record-reading
// @facet-role: primary
export function RecordPlace({
  ctx,
  id,
  section: addressed,
}: {
  ctx: PageContext;
  id: string;
  /** The section the address names (`/record/<id>/-/<section>`). */
  section?: string;
}) {
  const { t: tt } = useText();
  const [s, set] = ctx.slot<RecordState>("record", {
    tab: "record",
    rawFormat: "yaml",
    collapsed: [],
    scenarioFilter: "all",
    lookup: null,
  });
  const [stuck, stick] = useStuck();
  // The code zoom belongs to this browser, not to one record.
  const [codeZoom, setCodeZoom] = useState(() => loadCodeZoom());
  // The open source file; the newest request wins over a slower older one.
  const [openFile, setOpenFile] = useState<records.SourceFile | null>(null);
  const request = useRef(0);
  const base = recordOf(ctx.model, id, ctx.overview.history, ctx.overview);
  const record = base ? withDeclarations(ctx.model, base) : null;
  const section = sectionOf(addressed);
  const index = ctx.derived.glossary?.index;
  // Terms in the record's prose open their lookup beside the page.
  const prose = proseRenderer(
    index
      ? {
          index,
          onTerm: (term) => set({ lookup: { kind: "term", id: term, on: id } }),
          title: (term) => ctx.t("ui.reader-pages.records-look-up-term", { term }),
        }
      : null,
  );
  const lookup =
    s.lookup && s.lookup.on === id ? lookupTarget(ctx.model, ctx.derived, s.lookup) : null;
  if (!record)
    return (
      <records.RecordDetailsPage
        state="not-found"
        tab="record"
        mobile={ctx.mobile}
        missingId={id}
        nearest={nearestRecords(ctx.model, id).map((r) => r.id)}
        onNavigate={(to) =>
          ctx.go(
            to.kind === "record" ? href({ area: "record", id: to.id }) : href({ area: "records" }),
          )
        }
      />
    );
  const nav = (to: { kind: "product" | "records" | records.CrumbLevel; id: string }) => {
    switch (to.kind) {
      case "product":
        return ctx.go(href({ area: "product" }));
      case "records":
        // `kind:assumption` is the assumptions' segment: the collection, filtered to them.
        if (to.id === "kind:assumption")
          ctx.slot<RecordsQuery>("records", RECORDS_DEFAULT)[1]({
            query: "",
            filters: { kind: "assumption" },
            page: 1,
          });
        return ctx.go(href({ area: "records" }));
      case "domain":
        return ctx.go(href({ area: "domain", domain: to.id }));
      case "capability": {
        const [domain, capability] = to.id.split("/");
        return ctx.go(href({ area: "capability", domain, capability }));
      }
      case "record":
        return ctx.go(href({ area: "record", id: to.id }));
    }
  };
  const page = (
    <records.RecordDetailsPage
      state="ready"
      mobile={ctx.mobile}
      record={record}
      siblings={siblingsOf(ctx.model, ctx.domains, ctx.features, id)}
      siblingsOpen={ctx.crumb.open as records.CrumbLevel | null}
      siblingsQuery={ctx.crumb.query}
      onSiblingsQuery={ctx.crumb.setQuery}
      onCloseSiblings={ctx.crumb.close}
      stuck={stuck}
      onStick={stick}
      tab={s.tab}
      rawFormat={s.rawFormat}
      section={section}
      collapsed={s.collapsed}
      scenarioFilter={s.scenarioFilter}
      audienceFilter={s.audienceFilter ?? "all"}
      onAudienceFilter={(audienceFilter) => set({ audienceFilter })}
      now={new Date().toISOString().slice(0, 7)}
      onTab={(tab) => set({ tab })}
      onRawFormat={(rawFormat) => set({ rawFormat })}
      onSection={(k) => {
        // A section folded on the phone opens when it is picked.
        if (s.collapsed.includes(k)) set({ collapsed: s.collapsed.filter((x) => x !== k) });
        ctx.go(href({ area: "record", id, section: k }));
      }}
      codeZoom={codeZoom}
      onCodeZoom={(z) => {
        setCodeZoom(z);
        saveCodeZoom(z);
      }}
      openFile={openFile}
      onOpenAnchor={(a) => {
        const n = ++request.current;
        setOpenFile({ path: a.path, line: a.line, state: "loading" });
        void readSource(a.path, a.line).then((file) => {
          if (request.current === n) setOpenFile(file);
        });
      }}
      onCloseFile={() => {
        request.current++;
        setOpenFile(null);
      }}
      onToggleSection={(k) =>
        set({
          collapsed: s.collapsed.includes(k)
            ? s.collapsed.filter((x) => x !== k)
            : [...s.collapsed, k],
        })
      }
      onToggleSiblings={ctx.crumb.toggle}
      onNavigate={nav}
      onScenarioFilter={(scenarioFilter) => set({ scenarioFilter })}
      onOpenRule={(rid) => set({ lookup: { kind: "record", id: rid, on: id } })}
      onOpenDecision={(target) => ctx.go(href({ area: "plugin", plugin: "adr", rest: target }))}
      renderProse={prose}
      lookup={lookup}
      onCloseLookup={() => set({ lookup: null })}
      onFollowLookup={(to) => {
        set({ lookup: null });
        ctx.go(href({ area: "record", id: to }));
      }}
      onOpenDrift={() => ctx.go(href({ area: "contents", kind: "drift" }))}
      onCopy={(what) =>
        ctx.copy(
          what === "id"
            ? record.id
            : what === "raw"
              ? s.rawFormat === "json"
                ? record.json
                : record.yaml
              : record.anchors[0]
                ? `${record.anchors[0].path}:${record.anchors[0].line}`
                : record.id,
        )
      }
      onAsk={() => ctx.ask()}
      onAnswer={(slot) => ctx.ask(knowledgePrompt(ctx.t, tt, record.id, slot))}
    />
  );
  // Plugins' panels: one for the record, one for a scenario the address names.
  const scenario =
    addressed && !section
      ? (ctx.derived.byId[id]?.scen ?? []).find((x) => x.id === addressed)
      : undefined;
  const recordPanel = ctx.plugins?.slot("record.panel", { depth: 1, fid: id }) ?? null;
  const scenarioPanel = scenario
    ? (ctx.plugins?.slot("scenario.panel", { depth: 2, fid: id, sid: scenario.id }) ?? null)
    : null;
  if (!recordPanel && !scenarioPanel) return page;
  return (
    <>
      {page}
      <div className="t-page t-stack" data-testid="record-plugin-panels">
        {scenarioPanel ? (
          <section aria-label={scenario?.id}>
            <h2 className="t-h2 t-mono">{scenario?.id}</h2>
            {scenarioPanel}
          </section>
        ) : null}
        {recordPanel}
      </div>
    </>
  );
}
