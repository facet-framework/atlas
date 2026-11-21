/** The data shapes the records describe, under Contents: each entity with its
 * fields and the features that read and change it. A row opens the entity's
 * record, where its schema stands in full. */

import { ListRow, Pagination } from "@facet-tools/ui";

import { useSurfaceText as useText } from "@/screens/text";
import { contents } from "@/screens";
import type { AtlasModel } from "@/model";
import { short } from "@/derive";
import type { PageContext } from "../context";
import { href } from "../route";

/** The Contents kind the data shapes stand under. */
export const SHAPES_KIND = "data-shapes";

const PAGE = 12;

export type ShapeRow = {
  id: string;
  title: string;
  summary: string;
  fields: number;
  readers: number;
  writers: number;
};

/** Every entity record as a row, by title; nothing counted that the record does not say. */
export function shapeRows(model: AtlasModel): ShapeRow[] {
  return model.entities
    .map((e) => ({
      id: e.id,
      title: e.label || short(e.id),
      summary: (e.summary ?? "").trim().split("\n")[0] ?? "",
      fields: e.fields.length,
      readers: e.readBy.length,
      writers: e.mutatedBy.length,
    }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export function ShapesPage({ ctx }: { ctx: PageContext }) {
  const { t } = ctx;
  const ui = useText();
  const [s, set] = ctx.slot<{ page: number }>(`contents:${SHAPES_KIND}`, { page: 1 });
  const rows = shapeRows(ctx.model);
  const title = t("ui.reader-pages.shapes-data-shapes");
  return (
    <contents.KindFrame
      groupId="Context"
      group={ui.t("ui.reader-pages.shapes-context")}
      kindLabel={title}
      testId="shapes-page"
      figure={ui.number(rows.length)}
      sentence={t("ui.reader-pages.shapes-data-shapes-records-describe", {
        count: rows.length,
      })}
    >
      {rows.length ? (
        <>
          <div className="t-surface t-a-list" role="list" aria-label={title}>
            {rows.slice((s.page - 1) * PAGE, s.page * PAGE).map((r) => (
              <div key={r.id} role="listitem" data-testid="shapes-row">
                <ListRow
                  title={<span className="t-wrap">{r.title}</span>}
                  sub={
                    <span className="t-stack" style={{ gap: 2 }}>
                      {r.summary ? <span className="t-wrap">{r.summary}</span> : null}
                      <span className="t-meta t-wrap">
                        {[
                          r.id,
                          t("ui.reader-pages.shapes-count-fields", { count: r.fields }),
                          t("ui.reader-pages.shapes-count-features-read", { count: r.readers }),
                          t("ui.reader-pages.shapes-count-change", { count: r.writers }),
                        ].join(" · ")}
                      </span>
                    </span>
                  }
                  onClick={() => ctx.go(href({ area: "record", id: r.id }))}
                />
              </div>
            ))}
          </div>
          {rows.length > PAGE ? (
            <Pagination
              page={s.page}
              pageSize={PAGE}
              total={rows.length}
              pageSizes={[PAGE]}
              compact={ctx.mobile}
              onPage={(page) => set({ page })}
            />
          ) : null}
        </>
      ) : (
        <p className="t-muted" data-testid="shapes-none">
          {t("ui.reader-pages.shapes-no-record-describes-data-shape")}
        </p>
      )}
    </contents.KindFrame>
  );
}
