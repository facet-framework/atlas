/** The run behind Atlas: read the corpus stream, show the boot screen,
 * build the model, then hand over to the surface. */

import { useEffect, useState } from "react";
import {
  INDEX_PHASES,
  initialStatus,
  loadCorpus,
  phaseRank,
  subscribeCorpus,
  type AtlasModel,
  type CorpusSource,
  type IndexStatus,
} from "@/model";

import { BootScreen } from "@/chrome";
import type { DerivedGlossaryGroup } from "@/derive";
import type { SourceViewSummary } from "@/chrome/source-view";
import Atlas from "./Atlas";
import type { Addressing } from "./route";
import { useT, ReaderText } from "./text";
import { sharePercent } from "../share";

/** Progress combines the phase rank with its measured fraction.
 * Enumeration has no denominator: it is still discovering that denominator.
 * Keep this rule here even if a host supplies an estimated total while counting.
 * Otherwise the bar would claim a measured fraction while its label denies one. */

export function bootProgress(status: IndexStatus): number {
  const rank = Math.max(0, phaseRank(status.phase));
  const span = INDEX_PHASES.length - 1;
  const counting = status.phase === "enumerate";
  const within = !counting && status.total > 0 ? Math.min(1, status.done / status.total) : 0;
  return sharePercent(rank + within, span) ?? 0;
}

/** Milliseconds the mark needs to fly into the logo (`--t-dur-flight`). */
const FLIGHT_MS = 520;

/** What the boot screen shows for a scan status: a share only once there is a
 * total to measure it against, and a count only once it was taken. */

// @facet: registry/records/unmeasured-values
// @facet-role: primary
export function bootView(status: IndexStatus) {
  const counting = status.phase === "enumerate" || (status.total === 0 && status.phase !== "ready");
  const rank = phaseRank(status.phase);
  const recordsTaken = rank >= phaseRank("enumerate");
  const scanTaken = rank >= phaseRank("index");
  const count = (n: number, taken: boolean) => (n ? n : taken ? 0 : null);
  return {
    phase: status.phase,
    file: status.file || status.root || "",
    progress: counting ? null : bootProgress(status),
    counts: {
      records: count(status.records, recordsTaken),
      files: count(status.files, scanTaken),
      anchors: count(status.anchors, scanTaken),
    },
  };
}

type LiveProps = {
  url?: string;
  /** Where the reader keeps its address (see `Addressing`). */
  addressing?: Addressing;
};

/** The run in the Atlas language: the boot screen and the surface speak it alike. */

export default function AtlasLive(props: LiveProps) {
  return (
    <ReaderText>
      <AtlasRun {...props} />
    </ReaderText>
  );
}

function AtlasRun({ url = "/api/corpus", addressing = "path" }: LiveProps) {
  const { t } = useT();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<IndexStatus>(initialStatus);
  const [source, setSource] = useState<CorpusSource | null>(null);
  const [model, setModel] = useState<AtlasModel | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [landed, setLanded] = useState(false);

  useEffect(
    () =>
      subscribeCorpus(url, {
        onStatus: setStatus,
        onReady: (received) => {
          setStatus((previous) => ({ ...previous, phase: "model", file: "", done: 0, total: 0 }));
          setSource(received);
        },
        onError: setError,
      }),
    [attempt, url],
  );

  useEffect(() => {
    if (!source) return;
    try {
      const built = loadCorpus(source);
      // The build blocks the thread; running it in an effect puts the "model"
      // phase on screen first. The extra render pass is the point here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModel(built);
      setStatus((previous) => ({ ...previous, phase: "ready", records: built.recs.length }));
    } catch (caught) {
      setError(caught);
    }
  }, [source]);

  useEffect(() => {
    if (!model) return;
    const timer = window.setTimeout(() => setLanded(true), FLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [model]);

  if (error) {
    return (
      <div className="t-app">
        <BootScreen
          phase={status.phase}
          progress={null}
          counts={bootView(status).counts}
          error={{
            title: t("ui.reader.atlaslive-atlas-could-not-read-records"),
            reason: error instanceof Error ? error.message : String(error),
            onRetry: () => {
              setError(null);
              setSource(null);
              setModel(null);
              setStatus(initialStatus);
              setAttempt((n) => n + 1);
            },
          }}
        />
      </div>
    );
  }

  return (
    <>
      {model ? (
        <Atlas
          model={model}
          // Glossary groups accompany records outside `loadCorpus`.
          glossaryGroups={
            (source as { glossaryGroups?: DerivedGlossaryGroup[] } | null)?.glossaryGroups
          }
          sourceView={(source as { sourceView?: SourceViewSummary } | null)?.sourceView}
          pluginSections={source as Readonly<Record<string, unknown>> | undefined}
          // A new subscription reads the repository again; the surface and its
          // address stay until the new model replaces the old one.
          onReread={() => setAttempt((n) => n + 1)}
          addressing={addressing}
        />
      ) : null}
      {!landed ? (
        <div className="t-app">
          <BootScreen {...bootView(status)} leaving={!!model} />
        </div>
      ) : null}
    </>
  );
}
