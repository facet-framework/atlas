/** Loads the ADR model through the plugin's two host tools: the list, then
 * each file. A failed list fails the load; a failed read stays on its own
 * entry (`errors`), so one file the host would not hand out does not hide
 * every other decision. */

import { listAdrDirectory, readAdrFile, type Call } from "../host";
import { buildAdr, type AdrModel } from "./model";

function message(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export async function loadModel(call: Call): Promise<AdrModel> {
  const { dir, files } = await listAdrDirectory(call);
  const bodies: Record<string, string> = {};
  const errorState: Record<string, string> = {};
  for (const file of files) {
    try {
      bodies[file.path] = await readAdrFile(call, file.path, dir);
    } catch (caught: unknown) {
      errorState[file.path] = message(caught);
    }
  }
  return { ...buildAdr(files, bodies, errorState), directory: dir };
}
