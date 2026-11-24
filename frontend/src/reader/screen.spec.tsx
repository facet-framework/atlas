/** What the page shows reaches the chat as Markdown: the export is read from
 * the mounted shell (the rendered DOM), and the chat's question carries the
 * id the host gave for it — the address the host receives. */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentState, AgentStream } from "@/model";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import type { HostReaders } from "./host";
import { exportScreen, postScreen, screenRoot, SCREEN_PATH, type Screen } from "./screen";
import { atlasT, uiT } from "./testing";

const model = taskflowModel();
const t = atlasT("en");
const tt = uiT("en");

const SIGNED_IN: AgentState = {
  auth: { loggedIn: true, available: true, email: "a@b.c" },
  models: [{ id: "", label: "Default" }],
  model: "",
};

const readers: HostReaders = {
  repo: async () => {
    throw new Error("no repository in this spec");
  },
  agent: async () => SIGNED_IN,
  tools: async () => {
    throw new Error("no tools in this spec");
  },
  installed: async () => [],
};

function stream() {
  const urls: string[] = [];
  const open = (url: string): AgentStream => {
    urls.push(url);
    return { addEventListener: () => undefined, close: () => undefined };
  };
  const sent = (n = -1) => new URL(urls.at(n)!, "http://host").searchParams;
  return { open, urls, sent };
}

async function mount(path: string, props: Partial<Parameters<typeof Atlas>[0]> = {}) {
  window.history.replaceState(null, "", path);
  const view = render(<Atlas model={model} readers={readers} {...props} />);
  await act(async () => undefined);
  return view;
}

/** Every piece of text under an element that a reader reads (not what is aria-hidden). */
function texts(el: Element): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest('[aria-hidden="true"]')) continue;
    const text = (n.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

const field = () =>
  screen.getByRole("textbox", { name: tt("ui.screens-plugins.chat-question-atlas") });
const openDock = () =>
  userEvent.click(
    screen.getAllByRole("button", { name: new RegExp(t("ui.reader.chat-ask-atlas")) })[0],
  );

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

describe("screen export", () => {
  it("carries the overview's figures as rendered and leaves out the chat and the navigation", async () => {
    await mount("/", { openStream: stream().open });
    // The chat is open with a question in it, so there is chat text to leak.
    await openDock();
    await userEvent.type(field(), "What do you see here");
    const markdown = exportScreen(screenRoot());

    const kpis = texts(screen.getByTestId("overview-kpis"));
    expect(kpis.length).toBeGreaterThanOrEqual(4);
    for (const text of kpis) expect(markdown).toContain(text);
    expect(markdown).toContain(`# ${screen.getAllByRole("heading", { level: 1 })[0].textContent}`);

    expect(markdown).not.toContain("What do you see here");
    expect(markdown).not.toContain(t("ui.reader.chat-ask-atlas"));
    // Navigation names the page itself never shows stay out; the fixture has some.
    const main = screenRoot()!.textContent ?? "";
    const navOnly = within(screen.getByRole("navigation", { name: "Areas" }))
      .getAllByRole("button")
      .map((b) => b.textContent?.trim() ?? "")
      .filter((name) => name && !main.includes(name));
    expect(navOnly.length).toBeGreaterThan(0);
    for (const name of navOnly) expect(markdown).not.toContain(name);
  });

  it("turns the record table into a GFM table with the headers it shows", async () => {
    await mount("/records");
    await userEvent.click(screen.getByText("Table"));
    const table = screen.getByRole("grid");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => texts(h).join(" "));
    const markdown = exportScreen(screenRoot());
    expect(markdown).toContain(`| ${headers.join(" | ")} |`);
    expect(markdown).toContain(`| ${headers.map(() => "---").join(" | ")} |`);
    const firstRow = within(table).getAllByRole("row")[1];
    for (const cell of within(firstRow).getAllByRole("cell"))
      expect(markdown).toContain(texts(cell)[0]);
  });

  it("speaks the product city's names instead of leaving the map empty", async () => {
    await mount("/product");
    const city = screen.getByTestId("city");
    const markdown = exportScreen(screenRoot());
    expect(markdown).toContain(city.getAttribute("aria-label"));
    const towers = model.features.map((f) => screen.getByTestId(`tower-${f.id}`));
    for (const tower of towers) expect(markdown).toContain(tower.getAttribute("aria-label"));
  });

  it("leaves out what is hidden, furniture and layers, and draws an ARIA table as a table", () => {
    document.body.innerHTML = `
      <main>
        <h2>Shown</h2>
        <p hidden>hidden attribute</p>
        <p aria-hidden="true">aria hidden</p>
        <p style="display:none">display none</p>
        <p style="visibility:hidden">visibility hidden</p>
        <nav>nav text</nav>
        <div role="dialog">dialog text</div>
        <div role="menu">menu text</div>
        <script>script text</script>
        <style>.x{}</style>
        <input value="field value" />
        <svg><path d="M0 0"/></svg>
        <svg role="group" aria-label="A map"><text><tspan>Session</tspan><tspan>surfaces</tspan></text></svg>
        <canvas aria-label="A drawn chart">fallback words</canvas>
        <span role="img" aria-label="Three of five"></span>
        <details><summary>More</summary><p>closed body</p></details>
        <details open><summary>Open</summary><p>open body</p></details>
        <p><span title="not measured">—</span> lines</p>
        <div role="heading" aria-level="3">A role heading</div>
        <a href="/record/x">a link</a>
        <pre><code>code block</code></pre>
        <div role="table">
          <div role="row"><span role="columnheader">Name</span><span role="columnheader">Count</span></div>
          <div role="row"><span role="cell"><ul><li>a</li><li>b</li></ul></span><span role="cell">2</span></div>
        </div>
      </main>`;
    const markdown = exportScreen(screenRoot());
    for (const absent of [
      "hidden attribute",
      "aria hidden",
      "display none",
      "visibility hidden",
      "nav text",
      "dialog text",
      "menu text",
      "script text",
      ".x{}",
      "field value",
      "closed body",
    ])
      expect(markdown).not.toContain(absent);
    for (const present of [
      "## Shown",
      "A drawn chart",
      "A map\n\n-   Session surfaces",
      "fallback words",
      "Three of five",
      "More",
      "open body",
      "— (not measured) lines",
      "### A role heading",
      "[a link](/record/x)",
      "```\ncode block\n```",
      "| Name | Count |",
    ])
      expect(markdown).toContain(present);
    expect(markdown).toMatch(/^\| a b \| 2 +\|$/m);
    document.body.innerHTML = "";
  });

  it("cuts a long page at the limit and says so on the last line", () => {
    document.body.innerHTML = `<main>${Array.from({ length: 400 }, (_, i) => `<p>Paragraph ${i} with some words.</p>`).join("")}</main>`;
    const markdown = exportScreen(screenRoot(), 2000);
    expect(markdown.length).toBeLessThanOrEqual(2000);
    expect(markdown.split("\n").at(-1)).toBe("[Cut: the page continues beyond 2000 characters.]");
    expect(markdown).toContain("Paragraph 0 with some words.");
    expect(exportScreen(null)).toBe("");
    document.body.innerHTML = "";
  });
});

describe("chat sends the screen", () => {
  it("posts the page before the question and sends its id with it, from the dock and from a starter", async () => {
    const s = stream();
    const shots: Screen[] = [];
    const sendScreen = jest.fn(async (shot: Screen) => {
      shots.push(shot);
      return `id${shots.length}`;
    });
    await mount("/", { openStream: s.open, sendScreen });
    await openDock();
    await userEvent.type(field(), "was siehst du{Enter}");
    await waitFor(() => expect(s.urls).toHaveLength(1));
    expect(s.sent().get("screen")).toBe("id1");
    expect(s.sent().get("q")).toBe("was siehst du");
    expect(shots[0].page).toBe("/");
    for (const text of texts(screen.getByTestId("overview-kpis")))
      expect(shots[0].markdown).toContain(text);

    await userEvent.click(screen.getByRole("button", { name: tt("ui.screens-plugins.chat-stop") }));
    await userEvent.click(
      screen.getByRole("button", { name: t("ui.reader.chat-new-conversation") }),
    );
    const starter = screen.getAllByRole("button", { name: /\?$/ })[0];
    await userEvent.click(starter);
    await waitFor(() => expect(s.urls).toHaveLength(2));
    expect(s.sent().get("screen")).toBe("id2");
  });

  it("sends no page where no context chip is shown or the reader removed it", async () => {
    const s = stream();
    const sendScreen = jest.fn(async () => "id");
    const view = await mount("/ask", { openStream: s.open, sendScreen });
    await userEvent.type(field(), "x{Enter}");
    await waitFor(() => expect(s.urls).toHaveLength(1));
    view.unmount();
    window.localStorage.clear();

    await mount("/", { openStream: s.open, sendScreen });
    await openDock();
    const chips = screen.getByLabelText(tt("ui.screens-plugins.chat-context"));
    await userEvent.click(within(chips).getAllByRole("button")[0]);
    await userEvent.type(field(), "x{Enter}");
    await waitFor(() => expect(s.urls).toHaveLength(2));
    expect(sendScreen).not.toHaveBeenCalled();
    expect(s.sent().has("screen")).toBe(false);
  });

  it("asks without a screen when the host does not take it", async () => {
    for (const sendScreen of [async () => null, () => Promise.reject(new Error("offline"))]) {
      const s = stream();
      const view = await mount("/", { openStream: s.open, sendScreen });
      await openDock();
      await userEvent.type(field(), "x{Enter}");
      await waitFor(() => expect(s.urls).toHaveLength(1));
      expect(s.sent().has("screen")).toBe(false);
      view.unmount();
    }
  });

  it("opens no stream when the question is stopped before the screen was taken", async () => {
    const s = stream();
    let resolve: (id: string) => void = () => undefined;
    const sendScreen = () => new Promise<string | null>((r) => (resolve = r));
    await mount("/", { openStream: s.open, sendScreen });
    await openDock();
    await userEvent.type(field(), "x{Enter}");
    await userEvent.click(screen.getByRole("button", { name: tt("ui.screens-plugins.chat-stop") }));
    await act(async () => resolve("late"));
    expect(s.urls).toHaveLength(0);
  });
});

describe("postScreen", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("posts JSON to the host and returns its id, or null when the host refuses or is unavailable", async () => {
    const calls: [string, RequestInit][] = [];
    const answer = (res: Partial<Response>) =>
      (global.fetch = jest.fn(async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return res as Response;
      }) as unknown as typeof fetch);

    answer({ ok: true, json: async () => ({ id: "abc" }) });
    expect(await postScreen({ markdown: "# x", page: "/" })).toBe("abc");
    expect(calls[0][0]).toBe(SCREEN_PATH);
    expect(calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: "# x", page: "/" }),
    });

    answer({ ok: false });
    expect(await postScreen({ markdown: "x", page: "/" })).toBeNull();
    answer({ ok: true, json: async () => ({}) });
    expect(await postScreen({ markdown: "x", page: "/" })).toBeNull();
    global.fetch = jest.fn(() => Promise.reject(new Error("gone"))) as unknown as typeof fetch;
    expect(await postScreen({ markdown: "x", page: "/" })).toBeNull();
  });
});
