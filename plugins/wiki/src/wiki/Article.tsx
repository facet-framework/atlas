/**
 * One wiki page as the reader reads it: the head of the design system's wiki
 * article, the page's own body with its resolved `atlas:` references and
 * embeddings, and beside it the records the page names and its front matter.
 *
 * The design system's article draws its body with its own markdown, which
 * knows nothing of the corpus. This page needs `Body`: a reference resolved
 * against the running corpus, a dead one drawn dead with its reason, an
 * embedding computed. So the article is composed here from the same parts and
 * classes, with `Body` where the markdown stood.
 *
 * Editing and the page's history replace the body in place; both reach the
 * host through this plugin's `repo.*` grant, and neither is offered without a
 * host to ask.
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 *
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */
import { useMemo } from "react";
import { Badge, Breadcrumbs, Button, Icon } from "@facet-tools/ui";
import {
  Facts,
  useLifecycleLabel,
  useText,
} from "../../../../frontend/src/plugin/components";
import * as views from "../views/Wiki";
import { tx } from "../../../../frontend/src/i18n";
import { useOptionalCall } from "../bus";
import type { WikiModel, WikiPage } from "../model/model";
import Edit from "./Edit";
import Body from "./Body";
import { parsePage } from "./markdown";
import History from "./History";
import type { Corpus } from "./citations";
import "../wiki.css";

export type ArticleMode = "read" | "edit" | "history";

export function Article({
  w,
  p,
  status,
  k,
  crumbs,
  mode,
  onMode,
  onFilter,
  onOpen,
  onOpenRecord,
}: {
  w: WikiModel;
  p: WikiPage;
  status: { status: views.WikiStatus; rawStatus?: string };
  k: Corpus;
  /** The way to the page; the page itself is added as the place the reader stands. */
  crumbs: { key: string; label: string; onClick?: () => void }[];
  mode: ArticleMode;
  onMode: (mode: ArticleMode) => void;
  /** A tag sets the rail's filter: the tag on the page and the filter are one gesture. */
  onFilter: (tag: string) => void;
  /** A reference to another page stays inside the wiki. */
  onOpen: (address: string) => void;
  onOpenRecord: (id: string) => void;
}) {
  const { t: dt } = useText();
  const labels = views.useWikiLabels();
  const lifecycleLabel = useLifecycleLabel();
  const canAsk = useOptionalCall() !== null;
  const blocks = useMemo(
    () => parsePage(p.body, p.front.category),
    [p.body, p.front.category],
  );
  const catalogue = p.front.category ? w.category(p.front.category) : null;
  const words = p.body.split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 220));
  return (
    <article
      className="t-d-article t-anim-focus"
      aria-label={p.title}
      data-testid="wiki-article"
    >
      <Breadcrumbs crumbs={[...crumbs, { key: "page", label: p.title }]} />
      <header className="t-d-article__head">
        <div className="t-row t-row--wrap" style={{ gap: 8 }}>
          <views.WikiStatusBadge
            status={status.status}
            raw={status.rawStatus}
          />
          {p.front.category ? (
            catalogue ? (
              <Badge plain>{catalogue.title}</Badge>
            ) : (
              <span className="t-bad" data-testid="wiki-category-undeclared">
                <span className="t-mono">{p.front.category}</span> —{" "}
                {tx("ui.wiki-src-wiki.article-not-declared")}
              </span>
            )
          ) : (
            <span className="t-muted" data-testid="wiki-category-none">
              {tx("ui.wiki-src-wiki.article-filed-nobody")}
            </span>
          )}
          {p.tooDeep ? (
            <span
              className="t-warn"
              title={tx(
                "ui.wiki-src-wiki.article-page-exceeds-configured-depth-read-warned",
              )}
            >
              {tx("ui.wiki-src-wiki.article-deeper-than-two-levels")}
            </span>
          ) : null}
        </div>
        <h1 className="t-d-article__title">{p.title}</h1>
        {p.titled ? null : (
          // The path stands as the heading because the page needs a name; it
          // is a file name, and saying so keeps the missing `title` visible.
          <p className="t-meta" data-testid="wiki-untitled">
            {tx("ui.wiki-src-wiki.article-page-has-no-field-its-header", {
              field: "title",
            })}
          </p>
        )}
        {p.summary ? <p className="t-meta">{p.summary}</p> : null}
        <p className="t-meta">
          <span className="t-mono">{p.path}</span>
          {[
            p.front.owner?.team,
            p.front.reviewed
              ? dt("ui.wiki-src-wiki.article-changed-date", {
                  date: p.front.reviewed,
                })
              : null,
            dt("ui.wiki-src-wiki.article-words-words-minutes-min", {
              words,
              minutes,
            }),
          ]
            .filter(Boolean)
            .map((part) => ` · ${part}`)
            .join("")}
        </p>
        {canAsk ? (
          <div className="t-row t-row--wrap" style={{ gap: 8 }}>
            <Button
              variant={mode === "edit" ? "quiet" : "primary"}
              icon={mode === "read" ? "edit" : "back"}
              onClick={() => onMode(mode === "read" ? "edit" : "read")}
            >
              {mode === "read"
                ? dt("ui.wiki-src-wiki.article-edit")
                : dt("ui.wiki-src-wiki.article-page")}
            </Button>
            {mode === "read" ? (
              <Button icon="history" onClick={() => onMode("history")}>
                {dt("ui.wiki-src-wiki.article-history")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="t-d-article__grid">
        <div className="t-d-article__body">
          {mode === "edit" ? (
            <Edit p={p} onClose={() => onMode("read")} />
          ) : mode === "history" ? (
            <section
              aria-label={dt("ui.wiki-src-wiki.article-page-history")}
              data-testid="wiki-history-place"
            >
              <History path={p.path} />
            </section>
          ) : (
            <Body
              blocks={blocks}
              category={p.front.category}
              k={k}
              onWiki={onOpen}
            />
          )}
        </div>
        <aside className="t-d-article__side">
          <section
            className="t-d-card"
            aria-label={dt("ui.wiki-src-wiki.article-linked-records")}
          >
            <span className="t-label">
              {dt("ui.wiki-src-wiki.article-linked-records-count", {
                count: p.records.length,
              })}
            </span>
            {p.records.map((id) => {
              const f = k.v.byId[id];
              // An id no registry holds is an error under the specification, not a dead reference.
              return f ? (
                <button
                  key={id}
                  type="button"
                  className="t-d-recordlink"
                  onClick={() => onOpenRecord(f.id)}
                >
                  <span className="t-mono t-wrap">{f.id}</span>
                  <span className="t-row" style={{ gap: 6 }}>
                    <Badge plain>
                      <span data-testid="wiki-record-mark">
                        {lifecycleLabel(f.life)}
                      </span>
                    </Badge>
                    {f.claims ? (
                      <span className="t-meta">
                        {dt(
                          "ui.wiki-src-wiki.article-proven-total-test-named",
                          {
                            proven: f.proven,
                            total: f.claims,
                          },
                        )}
                      </span>
                    ) : null}
                  </span>
                </button>
              ) : (
                <span
                  key={id}
                  className="t-d-recordlink"
                  data-testid="wiki-record-dead"
                >
                  <s className="t-mono t-wrap">{id}</s>
                  <span className="t-bad t-meta">
                    {tx("ui.wiki-src-wiki.article-no-record-registry")}
                  </span>
                </span>
              );
            })}
          </section>
          <section className="t-d-card" aria-label="Front-Matter">
            <span className="t-label">Front-Matter</span>
            <Facts
              rows={[
                ["Status", labels.status(status.status, status.rawStatus)],
                [
                  dt("ui.wiki-src-wiki.article-category"),
                  catalogue?.title ?? p.front.category ?? "—",
                ],
                [
                  "Tags",
                  <span
                    key="t"
                    className="t-row t-row--wrap"
                    style={{ gap: 4 }}
                  >
                    {p.tags.length ? (
                      p.tags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className="t-d-linkbtn"
                          data-testid="wiki-tag"
                          onClick={() => onFilter(tag)}
                        >
                          <Icon name="search" size={12} /> {tag}
                        </button>
                      ))
                    ) : (
                      <span className="t-muted">
                        {dt("ui.wiki-src-wiki.article-none")}
                      </span>
                    )}
                  </span>,
                ],
                [
                  "Confluence",
                  // Not checked from here: absent, never "not connected".
                  <span
                    key="c"
                    title={dt("ui.wiki-src-wiki.article-not-checked")}
                    data-testid="wiki-sync-unmeasured"
                  >
                    —
                  </span>,
                ],
              ]}
            />
          </section>
        </aside>
      </div>
    </article>
  );
}
