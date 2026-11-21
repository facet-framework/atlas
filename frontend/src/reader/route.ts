/** Places in Atlas and their addresses. */

/** The Overview's address, the root every other place hangs under. */
export const ROOT = "/";

/** The segment between a record id and the section of its page:
 * `/record/<id>/-/<section>`. A record id never has "-" as a segment. */

export const SECTION_MARK = "-";

export type Route =
  | { area: "overview" }
  | { area: "product" }
  | { area: "domain"; domain: string }
  | { area: "capability"; domain: string; capability: string }
  | { area: "records" }
  | { area: "record"; id: string; section?: string }
  | { area: "contents"; kind?: string }
  | { area: "glossary"; term?: string }
  | { area: "settings"; section?: string }
  | { area: "plugin"; plugin: string; rest: string }
  | { area: "ask"; session?: string }
  | { area: "unknown"; path: string };

const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");

export function href(route: Route): string {
  switch (route.area) {
    case "overview":
      return ROOT;
    case "product":
    case "records":
      return `/${route.area}`;
    case "domain":
      return `/domain/${encodeURIComponent(route.domain)}`;
    case "capability":
      return `/domain/${encodeURIComponent(route.domain)}/${encodeURIComponent(route.capability)}`;
    case "record":
      return route.section
        ? `/record/${enc(route.id)}/${SECTION_MARK}/${encodeURIComponent(route.section)}`
        : `/record/${enc(route.id)}`;
    case "contents":
      return route.kind ? `/contents/${encodeURIComponent(route.kind)}` : `/contents`;
    case "glossary":
      return route.term ? `/glossary/${encodeURIComponent(route.term)}` : `/glossary`;
    case "settings":
      return route.section ? `/settings/${encodeURIComponent(route.section)}` : `/settings`;
    case "plugin":
      return `/p/${encodeURIComponent(route.plugin)}${route.rest ? `/${enc(route.rest)}` : ""}`;
    case "ask":
      return route.session ? `/ask/${encodeURIComponent(route.session)}` : `/ask`;
    case "unknown":
      return route.path;
  }
}

/** Where the reader keeps its address. `path` is the browser's path, as
 * `facet ui` serves it; `hash` is the fragment, for a host whose frame has
 * one fixed document, where a path of its own would not load again. */

export type Addressing = "path" | "hash";

/** The reader's current address under `mode`, without rewriting it. */
export function readAddress(mode: Addressing, location: Pick<Location, "pathname" | "hash">) {
  if (mode === "path") return location.pathname;
  const path = location.hash.replace(/^#/, "");
  return path.startsWith(ROOT) ? path : ROOT;
}

/** The URL to put into the browser's history for `path` under `mode`. */
export function addressUrl(
  mode: Addressing,
  path: string,
  location: Pick<Location, "pathname" | "search">,
) {
  return mode === "path" ? path : `${location.pathname}${location.search}#${path}`;
}

// @facet: workspace/navigation/places
// @facet-role: primary
export function parse(pathname: string): Route {
  if (!pathname.startsWith(ROOT)) return { area: "unknown", path: pathname };
  const parts = pathname
    .split("/")
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  const [head, ...rest] = parts;
  switch (head) {
    case undefined:
      return { area: "overview" };
    case "product":
      return { area: "product" };
    case "records":
      return { area: "records" };
    case "domain":
      if (rest.length === 1) return { area: "domain", domain: rest[0] };
      if (rest.length === 2) return { area: "capability", domain: rest[0], capability: rest[1] };
      break;
    case "record": {
      // A record id has several segments; a section follows its own mark.
      const mark = rest.indexOf(SECTION_MARK);
      if (mark > 0 && mark === rest.length - 2)
        return { area: "record", id: rest.slice(0, mark).join("/"), section: rest[mark + 1] };
      if (rest.length && mark < 0) return { area: "record", id: rest.join("/") };
      break;
    }
    case "contents":
      return rest[0] ? { area: "contents", kind: rest[0] } : { area: "contents" };
    case "glossary":
      return rest[0] ? { area: "glossary", term: rest[0] } : { area: "glossary" };
    case "settings":
      return rest[0]
        ? { area: "settings", section: rest[0] === "forge" ? "git-provider" : rest[0] }
        : { area: "settings" };
    case "p":
      if (rest[0]) return { area: "plugin", plugin: rest[0], rest: rest.slice(1).join("/") };
      break;
    case "ask":
      return rest[0] ? { area: "ask", session: rest[0] } : { area: "ask" };
  }
  return { area: "unknown", path: pathname };
}

/** The key of the area bar entry a route belongs to. */
export function navKey(route: Route): string {
  switch (route.area) {
    case "domain":
    case "capability":
      return "product";
    case "record":
      return "records";
    case "plugin":
      return route.plugin;
    default:
      return route.area;
  }
}
