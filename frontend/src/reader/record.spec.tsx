import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { href, parse } from "./route";
import { CODE_ZOOM_KEY, loadCodeZoom, readSource } from "./source";

const model = taskflowModel();
const ID = "tasks/create/quick-add";
// The anchor marker, split so this spec does not carry an anchor itself.
const TAG = "@fa" + "cet";

function mount(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={null} />);
}

const where = () => window.location.pathname;

let scrolled: Element[];
beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});
afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
  jest.restoreAllMocks();
});

const rail = () => screen.getByRole("navigation", { name: "Sections" });

describe("record sections have addresses (#871)", () => {
  it("prints and reads a section after the record id", () => {
    const route = { area: "record" as const, id: ID, section: "history" };
    expect(href(route)).toBe(`/record/${ID}/-/history`);
    expect(parse(href(route))).toEqual(route);
    expect(parse(`/record/${ID}`)).toEqual({ area: "record", id: ID });
    for (const path of ["/record/-/history", `/record/${ID}/-`, `/record/${ID}/-/a/b`]) {
      expect(parse(path)).toEqual({ area: "unknown", path });
    }
  });

  it("moves the address and the view to each picked section, and back with ‹", async () => {
    mount(`/record/${ID}`);
    for (const [name, key] of [
      [/^History/, "history"],
      [/^Relations/, "relations"],
      [/^Operations/, "operations"],
    ] as const) {
      await userEvent.click(within(rail()).getByRole("link", { name }));
      expect(where()).toBe(`/record/${ID}/-/${key}`);
      expect(scrolled.at(-1)).toBe(screen.getByTestId(`section-${key}`));
      expect(within(rail()).getByRole("link", { name })).toHaveAttribute(
        "aria-current",
        "location",
      );
    }
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(where()).toBe(`/record/${ID}/-/relations`);
    expect(within(rail()).getByRole("link", { name: /^Relations/ })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(scrolled.at(-1)).toBe(screen.getByTestId("section-relations"));
  });

  it("opens a shared address at its section", () => {
    mount(`/record/${ID}/-/operations`);
    expect(screen.getByRole("heading", { level: 1, name: "quick-add" })).toBeInTheDocument();
    expect(scrolled).toContain(screen.getByTestId("section-operations"));
  });
});

describe("the record view toggle (#873)", () => {
  it("is pressed while the raw record shows and returns to the record", async () => {
    mount(`/record/${ID}`);
    const button = () => screen.getByRole("button", { name: "View record" });
    expect(button()).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button());
    expect(button()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Record as YAML" })).toBeInTheDocument();
    await userEvent.click(button());
    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("region", { name: "Record as YAML" })).not.toBeInTheDocument();
  });
});

describe("code zoom (#872)", () => {
  it("sizes the raw code and keeps the level for the next visit", async () => {
    const first = mount(`/record/${ID}`);
    await userEvent.click(screen.getByRole("button", { name: "View record" }));
    await userEvent.click(screen.getByRole("button", { name: "Larger code" }));
    await userEvent.click(screen.getByRole("button", { name: "Larger code" }));
    const pre = () => screen.getByRole("region", { name: "Record as YAML" }).querySelector("pre");
    expect(pre()).toHaveStyle({ fontSize: "calc(var(--t-fs-12) * 1.25)" });
    expect(window.localStorage.getItem(CODE_ZOOM_KEY)).toBe("125");
    first.unmount();

    mount(`/record/${ID}`);
    await userEvent.click(screen.getByRole("button", { name: "View record" }));
    expect(pre()).toHaveStyle({ fontSize: "calc(var(--t-fs-12) * 1.25)" });
    await userEvent.click(screen.getByRole("button", { name: /^Reset code size/ }));
    expect(pre()).toHaveStyle({ fontSize: "calc(var(--t-fs-12) * 1)" });
    expect(loadCodeZoom()).toBe(100);
  });
});

describe("source view (#870)", () => {
  const FILE = [
    "import { parseInput } from './parse_input';",
    "",
    `// ${TAG}: ${ID}`,
    `// ${TAG}-role: primary`,
    "export async function quickAdd(input: string) {",
    "  return parseInput(input);",
    "}",
  ].join("\n");

  function hostAnswers(body: unknown) {
    const calls: string[] = [];
    window.fetch = jest.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as typeof fetch;
    return calls;
  }

  it("reads the file through the host and shows it at the anchor line", async () => {
    const calls = hostAnswers({
      state: "ok",
      path: "apps/mobile/src/tasks/quick_add.ts",
      text: FILE,
      anchors: [{ line: 3, id: ID, role: "primary" }],
    });
    mount(`/record/${ID}`);
    const code = screen.getByTestId("section-code");
    await userEvent.click(within(code).getByRole("button", { name: /quick_add\.ts\s*:48/ }));
    const editor = await within(code).findByTestId("source-editor-body");
    // The session's plugin host asks for its own things; the source is read once.
    expect(calls.filter((u) => u.startsWith("/api/source"))).toEqual([
      "/api/source?path=apps%2Fmobile%2Fsrc%2Ftasks%2Fquick_add.ts",
    ]);
    expect(editor.querySelectorAll("[data-line]")).toHaveLength(7);
    expect(editor.querySelector('[data-line="3"]')).toHaveAttribute("data-anchor", "true");
    expect(editor.querySelector('[data-line="5"] [data-token="kw"]')?.textContent).toBe("export");
    expect(screen.getByText("TypeScript")).toBeInTheDocument();

    fireEvent.keyDown(editor, { key: "Escape" });
    expect(screen.queryByTestId("source-editor")).not.toBeInTheDocument();
    expect(within(code).getByRole("button", { name: /quick_add\.ts\s*:48/ })).toHaveFocus();
  });

  it("names the host's refusal instead of showing an empty file", async () => {
    hostAnswers({ state: "not-anchored", path: "x" });
    mount(`/record/${ID}`);
    const code = screen.getByTestId("section-code");
    await userEvent.click(within(code).getByRole("button", { name: /quick_add\.ts\s*:48/ }));
    expect(await within(code).findByTestId("source-editor-error")).toHaveTextContent(
      "No anchor in this file",
    );
  });

  it("answers a failed request as unreadable", async () => {
    const down = jest.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(readSource("a.go", 1, down)).resolves.toEqual({
      path: "a.go",
      line: 1,
      state: "error",
      reason: "network",
    });
    const status = jest.fn(
      async () => new Response("no", { status: 403 }),
    ) as unknown as typeof fetch;
    await expect(readSource("a.go", 1, status)).resolves.toMatchObject({ reason: "network" });
    await act(async () => {});
  });
});
