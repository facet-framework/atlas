import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import {
  fetchInstalledPlugins,
  fetchPluginCapabilities,
  resolveInstalledPlugins,
} from "@/plugin/installed";
import type { PluginEntry } from "@/plugin/api";
import type * as InstalledModule from "@/plugin/installed";
import { HISTORY_KEY, type History } from "./history";

jest.mock("@/plugin/installed", () => ({
  ...jest.requireActual("@/plugin/installed"),
  fetchInstalledPlugins: jest.fn(),
  fetchPluginCapabilities: jest.fn(),
  resolveInstalledPlugins: jest.fn(),
}));
const listing = {
  id: "sample",
  name: "Sample",
  version: "0.1.0",
  api: 0,
  entry: "/plugins/sample/plugin.js",
  areas: ["sample"],
  slots: [],
  dev: false,
  verification: "ok" as const,
};
const entry: PluginEntry = (atlas) => {
  atlas.areas.register(
    "sample",
    ({ state, setState }) =>
      atlas.ui.h(
        "div",
        null,
        atlas.ui.h("h1", null, "Installed sample"),
        atlas.ui.h("p", null, String(state)),
        atlas.ui.h("button", { onClick: () => setState("second") }, "Next model"),
      ),
    { initial: (arg) => arg || "first", place: (s) => s },
  );
};
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  jest.mocked(fetchInstalledPlugins).mockResolvedValue([listing]);
  jest.mocked(fetchPluginCapabilities).mockResolvedValue({ sample: "capability" });
  jest.mocked(resolveInstalledPlugins).mockResolvedValue({
    loaded: [{ id: "sample", entry }],
    states: [{ status: "loaded", listing }],
  });
  window.history.replaceState(null, "", "/p/sample");
});
it("loads an installed area and keeps its selected model in the address", async () => {
  render(<Atlas model={taskflowModel()} readers={null} />);
  expect(await screen.findByRole("heading", { name: "Installed sample" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next model" }));
  expect(window.location.pathname).toBe("/p/sample/second");
  expect(screen.getByText("second")).toBeInTheDocument();
  expect(fetchPluginCapabilities).toHaveBeenCalledWith(
    ["adr", "bpmn", "dmn", "wiki", "sample"],
    global.fetch,
  );
});
it("does not import when a session capability is absent", async () => {
  jest.mocked(fetchPluginCapabilities).mockResolvedValue({});
  render(<Atlas model={taskflowModel()} readers={null} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Plugin session unavailable");
  expect(resolveInstalledPlugins).not.toHaveBeenCalled();
});
it("shows a verification refusal without loading the area", async () => {
  // The real loader decides; only the module import is handed in, and it would
  // hand over the area's entry if the loader ever asked for it.
  const { resolveInstalledPlugins: realResolve } =
    jest.requireActual<typeof InstalledModule>("@/plugin/installed");
  const imported: string[] = [];
  const importer = (url: string) => {
    imported.push(url);
    return Promise.resolve({ default: entry });
  };
  jest
    .mocked(resolveInstalledPlugins)
    .mockImplementation((items, bundled) => realResolve(items, bundled, importer));

  // The fixture's precondition: with a verified listing, this loader and
  // importer do render the area, so its absence below is the refusal.
  const verified = render(<Atlas model={taskflowModel()} readers={null} />);
  expect(await screen.findByRole("heading", { name: "Installed sample" })).toBeInTheDocument();
  expect(imported).toEqual([listing.entry]);
  verified.unmount();
  imported.length = 0;

  jest
    .mocked(fetchInstalledPlugins)
    .mockResolvedValue([{ ...listing, verification: "checksum-mismatch" }]);
  // The real claim, as production makes it: it names only verified plugins,
  // so the host never issues a capability for this one.
  const { fetchPluginCapabilities: realClaim } =
    jest.requireActual<typeof InstalledModule>("@/plugin/installed");
  jest.mocked(fetchPluginCapabilities).mockImplementation(realClaim);
  const claimed: unknown[] = [];
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) !== "/api/plugin/session")
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: {} }) } as Response);
    const asked = JSON.parse(String(init?.body)) as { plugins: string[] };
    claimed.push(asked);
    const capabilities = Object.fromEntries(asked.plugins.map((id) => [id, `cap-${id}`]));
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ capabilities }) } as Response);
  }) as unknown as typeof fetch;
  window.history.replaceState(null, "", "/p/sample");
  render(<Atlas model={taskflowModel()} readers={null} />);
  // The verification's own reason, not a missing session.
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Plugin unavailable: not-loaded (checksum-mismatch)",
  );
  expect(claimed).toEqual([{ plugins: ["adr", "bpmn", "dmn", "wiki"] }]);
  expect(screen.queryByRole("heading", { name: "Installed sample" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Next model" })).not.toBeInTheDocument();
  // The refused module was never imported.
  expect(imported).toEqual([]);
});
it("leaves an absent package as a missing place", async () => {
  jest.mocked(fetchInstalledPlugins).mockResolvedValue([]);
  await act(async () => {
    render(<Atlas model={taskflowModel()} readers={null} />);
  });
  expect(resolveInstalledPlugins).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Installed sample" })).not.toBeInTheDocument();
});
it("claims every capability once, before installed code runs, while the reader changes places", async () => {
  const real = jest.requireActual<typeof InstalledModule>("@/plugin/installed");
  // The real listing, claim and loader; only the network and the import are test substitutes.
  jest.mocked(fetchInstalledPlugins).mockImplementation(real.fetchInstalledPlugins);
  jest.mocked(fetchPluginCapabilities).mockImplementation(real.fetchPluginCapabilities);
  const log: string[] = [];
  const claims: unknown[] = [];
  jest.mocked(resolveInstalledPlugins).mockImplementation((items, bundled) =>
    real.resolveInstalledPlugins(items, bundled, (url) => {
      log.push(`import ${url}`);
      return Promise.resolve({ default: entry });
    }),
  );
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    log.push(u);
    let body: unknown = { result: {} };
    if (u === "/api/plugins")
      body = {
        plugins: [
          listing,
          {
            ...listing,
            id: "broken",
            entry: "/plugins/broken/plugin.js",
            areas: ["broken"],
            verification: "checksum-mismatch",
          },
        ],
      };
    else if (u === "/api/plugin/session") {
      claims.push(JSON.parse(String(init?.body)));
      body = { capabilities: { adr: "a", bpmn: "b", sample: "s" } };
    } else if (u === "/api/plugin/call") body = { result: { files: [] } };
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve(body),
    } as Response);
  }) as unknown as typeof fetch;
  const move = (to: string) =>
    act(() => {
      window.history.pushState(null, "", to);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

  window.history.replaceState(null, "", "/p/bpmn");
  render(<Atlas model={taskflowModel()} readers={null} />);
  // The bundled place has used its caller, so it took part in the claim.
  await waitFor(() => expect(log).toContain("/api/plugin/call"));
  move("/p/sample");
  expect(await screen.findByRole("heading", { name: "Installed sample" })).toBeInTheDocument();
  move("/p/adr");
  move("/p/sample");
  expect(await screen.findByRole("heading", { name: "Installed sample" })).toBeInTheDocument();

  // One claim for the whole document, naming the bundled and the verified
  // installed plugins and not the refused one.
  expect(claims).toEqual([{ plugins: ["adr", "bpmn", "dmn", "wiki", "sample"] }]);
  expect(log.filter((u) => u === "/api/plugin/session")).toHaveLength(1);
  // The claim came before any installed code was imported.
  const imported = log.findIndex((u) => u.startsWith("import "));
  expect(imported).toBeGreaterThan(log.indexOf("/api/plugin/session"));
  expect(log.filter((u) => u === "import /plugins/broken/plugin.js")).toHaveLength(0);
});
it("renames the current place when the area names it anew: no new step, and the history list and back follow", async () => {
  window.history.replaceState(null, "", "/records");
  render(<Atlas model={taskflowModel()} readers={null} />);
  act(() => {
    window.history.pushState(null, "", "/p/sample");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(await screen.findByRole("heading", { name: "Installed sample" })).toBeInTheDocument();
  const stored = () =>
    (JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "{}") as History).places.map(
      (p) => p.path,
    );
  // Precondition: the area is a visit of its own after the records.
  expect(stored()).toEqual(["/records", "/p/sample"]);

  fireEvent.click(screen.getByRole("button", { name: "Next model" }));
  expect(window.location.pathname).toBe("/p/sample/second");
  // The place under the cursor is renamed; nothing was added.
  expect(stored()).toEqual(["/records", "/p/sample/second"]);
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  const list = screen.getByRole("menu", { name: "History" });
  const current = list.querySelector('[aria-current="true"]');
  expect(current).toHaveTextContent("second");
  expect(screen.getByText("History · 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "History" }));

  // Back leaves the area for the records, not for the address it had before.
  fireEvent.click(screen.getByRole("button", { name: /^Back/ }));
  expect(window.location.pathname).toBe("/records");
  fireEvent.click(screen.getByRole("button", { name: /^Forward/ }));
  expect(window.location.pathname).toBe("/p/sample/second");
  // The area kept its state at the renamed address instead of opening afresh.
  expect(await screen.findByText("second")).toBeInTheDocument();
});
