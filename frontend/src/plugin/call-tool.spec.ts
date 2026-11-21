/** What a plugin gets from the host and how its calls leave it: the exact API
 * fields, one load per id, and every outward call — `bus.call` and
 * `slots.notify` alike — posted to `/api/plugin/call` in the plugin's own name
 * with its capability, each refusal and failure coming back as a result. The
 * cases read the request the host sent and the result the plugin got. */

import { PluginHost, type AtlasApi } from "./host";

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

const nav = {
  go: jest.fn(),
  open: jest.fn(),
  openScenario: jest.fn(),
  openArea: jest.fn(),
  closeArea: jest.fn(),
  openSheet: jest.fn(),
  openCatalogue: jest.fn(),
  setRole: jest.fn(),
};

/** A host whose fetcher answers `answer`, with `id` loaded and its capability set. */
function hostWith(answer: () => Promise<unknown>, id = "probe", capabilities = { [id]: "cap-1" }) {
  const sent: Sent[] = [];
  const host = new PluginHost();
  host.fetcher = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return answer();
  }) as never;
  let api: AtlasApi | null = null;
  host.load(id, (a) => void (api = a), nav as never);
  host.setCapabilities(capabilities);
  return { sent, api: api! };
}

const response = (status: number, json: () => Promise<unknown>, statusText = "") =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, statusText, json });

describe("what a plugin is handed", () => {
  it("names exactly these fields, and none of them is a way to the network", () => {
    const { api } = hostWith(() => response(200, async () => ({})));
    expect(Object.keys(api).sort()).toEqual(
      [
        "api",
        "areas",
        "bus",
        "chat",
        "commands",
        "data",
        "id",
        "roles",
        "search",
        "settings",
        "slots",
        "theme",
        "tiles",
        "ui",
        "verbs",
      ].sort(),
    );
    expect(Object.keys(api.bus).sort()).toEqual(["call", "emit", "on"]);
    expect(api).not.toHaveProperty("fetch");
    expect(api).not.toHaveProperty("net");
  });

  it("is loaded once per id: a second load is refused and the entry runs once", () => {
    const host = new PluginHost();
    let runs = 0;
    const entry = () => void runs++;
    expect(host.load("p", entry, nav as never)).toBe(true);
    expect(host.load("p", entry, nav as never)).toBe(false);
    expect(runs).toBe(1);
  });
});

describe("a plugin's call", () => {
  it("goes out in the plugin's own name with its capability, whatever id the arguments carry", async () => {
    const { sent, api } = hostWith(() => response(200, async () => ({ result: 1 })), "notes", {
      notes: "cap-notes",
      adr: "cap-adr",
    });
    await expect(api.bus.call("repo.state", { plugin: "adr" })).resolves.toEqual({
      ok: true,
      result: 1,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/plugin/call");
    expect(sent[0].headers["X-Facet-Plugin-Capability"]).toBe("cap-notes");
    expect(sent[0].body).toEqual({ plugin: "notes", tool: "repo.state", args: { plugin: "adr" } });
  });

  it.each([
    ["no capability", null, { denied: expect.any(String) }],
    [
      "a host that does not answer",
      () => Promise.reject(new Error("offline")),
      { error: expect.stringContaining("offline") },
    ],
    [
      "a 403 from the guard",
      () => response(403, async () => ({}), "Forbidden"),
      { denied: "403 Forbidden" },
    ],
    [
      "a route that is not there",
      () => response(404, async () => ({}), "Not Found"),
      { error: expect.stringContaining("404") },
    ],
    [
      "a failing route",
      () => response(500, async () => ({}), "Server Error"),
      { error: expect.stringContaining("500") },
    ],
    [
      "an answer that is not JSON",
      () => response(200, () => Promise.reject(new SyntaxError("Unexpected token"))),
      { error: expect.stringContaining("Unexpected token") },
    ],
    [
      "a refusal in the body",
      () => response(200, async () => ({ denied: "not granted" })),
      { denied: "not granted" },
    ],
    [
      "a failure in the body",
      () => response(200, async () => ({ error: "broke" })),
      { error: "broke" },
    ],
  ])("comes back as a result, never an exception, for %s", async (_name, answer, expected) => {
    const { api, sent } = answer
      ? hostWith(answer as () => Promise<unknown>)
      : hostWith(() => response(200, async () => ({})), "probe", {});
    const result = await api.bus.call("repo.state");
    expect(result).toEqual({ ok: false, ...expected });
    // A refusal is never also an error, and an error never a refusal.
    expect(Object.keys(result).sort()).toEqual(["ok", Object.keys(expected)[0]].sort());
    // Without a capability nothing leaves; every other case reached the route once.
    expect(sent).toHaveLength(answer ? 1 : 0);
  });
});

describe("marking a slot as new", () => {
  it("is a call like any other: declared as ui.notify, in the plugin's name, with its capability", async () => {
    const { sent, api } = hostWith(() => response(200, async () => ({ denied: "ungranted" })));
    await expect(api.slots.notify("header.action", true)).resolves.toEqual({
      ok: false,
      denied: "ungranted",
    });
    expect(sent).toEqual([
      {
        url: "/api/plugin/call",
        headers: expect.objectContaining({ "X-Facet-Plugin-Capability": "cap-1" }),
        body: { plugin: "probe", tool: "ui.notify", args: { place: "header.action", on: true } },
      },
    ]);
  });
});
