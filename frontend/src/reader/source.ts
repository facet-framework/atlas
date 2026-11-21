/** What the record's code section reads from the host: one anchored source file,
 * through `GET /api/source`, and the code zoom this browser keeps. */

import { records } from "@/screens";

export const SOURCE_PATH = "/api/source";
export const CODE_ZOOM_KEY = "facet.atlas.codeZoom";

type HostAnswer = {
  state?: unknown;
  path?: unknown;
  text?: unknown;
  anchors?: unknown;
};

/** Read one file through the host. The answer is the view's file state: ready
 * with text and the anchors the host found, or an error with the host's fixed
 * reason. A failed request is the reason "network", never an empty file. */

export async function readSource(
  path: string,
  line: number,
  fetcher: typeof fetch = (...a) => fetch(...a),
): Promise<records.SourceFile> {
  try {
    const res = await fetcher(`${SOURCE_PATH}?path=${encodeURIComponent(path)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { path, line, state: "error", reason: "network" };
    const body = (await res.json()) as HostAnswer;
    if (body.state !== "ok" || typeof body.text !== "string") {
      return {
        path,
        line,
        state: "error",
        reason: typeof body.state === "string" ? body.state : "network",
      };
    }
    const anchors = Array.isArray(body.anchors)
      ? body.anchors.flatMap((a: unknown) => {
          const x = a as { line?: unknown; id?: unknown; role?: unknown };
          return typeof x.line === "number" && typeof x.id === "string"
            ? [{ line: x.line, id: x.id, role: typeof x.role === "string" ? x.role : undefined }]
            : [];
        })
      : [];
    return { path, line, state: "ready", text: body.text, anchors };
  } catch {
    return { path, line, state: "error", reason: "network" };
  }
}

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored code zoom, snapped to a level; 100 when nothing is stored. */
export function loadCodeZoom(s: Pick<Storage, "getItem"> | undefined = storage()): number {
  try {
    const raw = s?.getItem(CODE_ZOOM_KEY);
    return records.codeZoomLevel(raw == null ? undefined : Number(raw));
  } catch {
    return records.CODE_ZOOM_DEFAULT;
  }
}

export function saveCodeZoom(
  zoom: number,
  s: Pick<Storage, "setItem"> | undefined = storage(),
): void {
  try {
    s?.setItem(CODE_ZOOM_KEY, String(records.codeZoomLevel(zoom)));
  } catch {
    /** the level holds for this visit only */
  }
}
