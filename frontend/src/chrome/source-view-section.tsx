/** The source-view disclosure in the settings' repository section. */

import { contents } from "@/screens";
import type { T } from "../reader/text";
import type { SourceViewSummary } from "./source-view";

/** A revision and a content hash, as the host sent them. */
function Identity({ revision, hash, t }: { revision?: string; hash: string; t: T }) {
  return (
    <span className="t-stack" style={{ gap: 2, alignItems: "flex-end" }}>
      {revision ? (
        <span className="t-c-small">
          {t("ui.chrome.source-view-section-revision")} <code className="t-mono">{revision}</code>
        </span>
      ) : null}
      <span className="t-c-small">
        {t("ui.chrome.source-view-section-content")} <code className="t-mono">{hash}</code>
      </span>
    </span>
  );
}

/** The named source view the corpus was resolved through, under the repository
 * section: the record repository with its revision and record hash, then each
 * selected source repository with revision, content hash and whether it has
 * local changes. A corpus without a view draws nothing. */

export function SourceViewSection({ view, t }: { view?: SourceViewSummary; t: T }) {
  if (!view) return null;
  return (
    <div data-testid="source-view">
      <contents.SettingsSection
        title={t("ui.chrome.source-view-section-source-view-name", { name: view.name })}
      >
        <div className="t-surface t-c-setgroup">
          <contents.SettingRow
            label={t("ui.chrome.source-view-section-record-repository")}
            desc={
              <span data-testid="source-view-registry">
                {view.registryRepository ||
                  t("ui.chrome.source-view-section-repository-identity-not-declared")}
              </span>
            }
            control={
              <Identity revision={view.registryRevision} hash={view.recordContentHash} t={t} />
            }
          />
          {view.sources.map((source) => (
            <div key={source.repository} data-testid="source-view-source">
              <contents.SettingRow
                label={<span className="t-mono">{source.repository}</span>}
                desc={
                  <span data-testid="source-view-dirty" data-dirty={source.dirty}>
                    {source.dirty
                      ? t("ui.chrome.source-view-section-has-local-changes")
                      : t("ui.chrome.source-view-section-no-local-changes")}
                  </span>
                }
                control={<Identity revision={source.revision} hash={source.contentHash} t={t} />}
              />
            </div>
          ))}
        </div>
      </contents.SettingsSection>
    </div>
  );
}
