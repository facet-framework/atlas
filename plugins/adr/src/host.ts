/** Repository tools used by the ADR plugin. */

import type { BusCallResult } from "../../../frontend/src/plugin/host";

export const DEFAULT_ADR_DIRECTORY = "docs/adr";

const LIST_TOOL = "repo.list";
const READ_TOOL = "repo.read";

/** What `atlas.bus.call` looks like — as a parameter, so a test can supply a fake. */
export type Call = (tool: string, args?: unknown) => Promise<BusCallResult>;

/** An error naming which of the two tools failed, and the host's own text. */
export class AdrHostError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(message);
    this.name = "AdrHostError";
  }
}

async function post(
  call: Call,
  tool: string,
  args: unknown,
): Promise<Record<string, unknown>> {
  const result = await call(tool, args);
  if (!result.ok) {
    throw new AdrHostError(
      tool,
      "denied" in result ? result.denied : result.error,
    );
  }
  return (result.result as Record<string, unknown>) ?? {};
}

/** One file `repo.list` names — the raw entry, unparsed beyond number/slug. */
export type AdrFileEntry = { path: string; number: string; slug: string };

/** The host resolves the repository's configured ADR directory. */
export async function listAdrDirectory(
  call: Call,
): Promise<{ dir: string; files: AdrFileEntry[] }> {
  const result = await post(call, LIST_TOOL, {});
  return {
    dir: (result.dir as string | undefined) ?? DEFAULT_ADR_DIRECTORY,
    files: (result.files as AdrFileEntry[] | undefined) ?? [],
  };
}

export async function listAdrFiles(call: Call): Promise<AdrFileEntry[]> {
  return (await listAdrDirectory(call)).files;
}

/** Asks the host for one file's raw body, by the path `listAdrFiles` named. */
export async function readAdrFile(
  call: Call,
  path: string,
  dir = DEFAULT_ADR_DIRECTORY,
): Promise<string> {
  const result = await post(call, READ_TOOL, { dir, path });
  return (result.body as string | undefined) ?? "";
}
