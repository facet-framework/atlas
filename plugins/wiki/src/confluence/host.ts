/** Fetch the connection state and normalize fields omitted by the host. */

import { tx } from "../../../../frontend/src/i18n";
import type { Area } from "./tree";
import type { Reach } from "./state";
import type { Connection } from "./mapping";

const STATE = "/api/wiki/confluence/state";

/** Fetch the connection state and normalize fields omitted by the host. */
export type HostState = {
  instance: string | null;
  instanceSource: string | null;
  /** The NAME of the environment variable. Its value never reaches the browser. */
  tokenSource: string | null;
  areas: Area[];
  connections: HostConnection[];
  reaches: Reach[];
  /** How many spaces an answer named — `null` as long as none did. */
  spaces?: number | null;
};

/** Fetch the connection state and normalize fields omitted by the host. */
export type HostConnection = Connection & { pages?: number | null };

export async function loadState(
  fetcher: typeof fetch = fetch,
): Promise<HostState> {
  const answer = await fetcher(STATE);
  if (!answer.ok)
    throw new Error(
      tx("ui.wiki-src-confluence.host-host-answered-status", {
        status: answer.status,
      }),
    );
  const raw = (await answer.json()) as Partial<HostState>;
  return {
    instance: raw.instance ?? null,
    instanceSource: raw.instanceSource ?? null,
    tokenSource: raw.tokenSource ?? null,
    areas: raw.areas ?? [],
    connections: raw.connections ?? [],
    reaches: raw.reaches ?? [],
    // `?? null` and not `?? 0`: a missing number is not a zero, and the
    // status line tells the two apart.
    spaces: raw.spaces ?? null,
  };
}
