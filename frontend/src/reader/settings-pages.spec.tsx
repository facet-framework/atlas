/** The settings of Atlas as the application mounts them: a page in the
 * frame under the shell, the host asked once and not again per page, and the
 * AI page stating the isolation the host reports. */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import type { HostReaders } from "./host";
import { uiT } from "./testing";

const en = uiT("en");
const where = () => window.location.pathname;

let mounted: ReturnType<typeof render> | null = null;
async function mount(path: string, readers: HostReaders | null = null) {
  mounted?.unmount();
  window.history.replaceState(null, "", path);
  mounted = render(<Atlas model={taskflowModel()} readers={readers} />);
  // The bundled plugins register after the first paint.
  await act(async () => undefined);
  await act(async () => undefined);
  return mounted;
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

const realMatchMedia = window.matchMedia;
function phone() {
  window.matchMedia = ((query: string) => ({
    matches: query === "(max-width: 767px)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  window.matchMedia = realMatchMedia;
});

describe("settings in the frame", () => {
  it("stand in the main frame while the shell head and the area bar stay drawn", async () => {
    await mount("/settings");
    expect(document.querySelector<HTMLElement>(".t-shell__head")!).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Areas" })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: en("ui.screens-contents.settings-settings") }),
    ).toBeInTheDocument();
  });

  it("ask the host once when the app mounts, and not again for any page the reader opens", async () => {
    const asked = { repo: 0, agent: 0, tools: 0, installed: 0 };
    const readers: HostReaders = {
      repo: async () => {
        asked.repo++;
        return null as never;
      },
      agent: async () => {
        asked.agent++;
        return null as never;
      },
      tools: async () => {
        asked.tools++;
        return { available: false, tools: [] };
      },
      installed: async () => {
        asked.installed++;
        return [];
      },
    };
    await mount("/settings", readers);
    await waitFor(() => expect(asked).toEqual({ repo: 1, agent: 1, tools: 1, installed: 1 }));
    const nav = screen.getByRole("navigation", {
      name: en("ui.screens-contents.settings-settings"),
    });
    const pages = within(nav).getAllByRole("button");
    // Precondition: there are several pages to move between.
    expect(pages.length).toBeGreaterThan(4);
    for (let i = 0; i < pages.length; i++) {
      await userEvent.click(
        within(
          screen.getByRole("navigation", {
            name: en("ui.screens-contents.settings-settings"),
          }),
        ).getAllByRole("button")[i],
      );
    }
    expect(where()).not.toBe("/settings");
    expect(asked).toEqual({ repo: 1, agent: 1, tools: 1, installed: 1 });
  });
});

const SIGNED_IN = {
  auth: { loggedIn: true, available: true, email: "a@b.c" },
  models: [{ id: "", label: "Default" }],
  model: "",
  allowedTools: ["Read"],
  blockedTools: ["Bash", "Write"],
  fixedTools: ["Bash", "Write"],
};

const aiReaders = (agent: unknown): HostReaders => ({
  repo: () => new Promise(() => undefined),
  agent: async () => agent as never,
  tools: async () => ({ available: false, tools: [] }),
  installed: async () => [],
});

describe("settings on a phone", () => {
  it("shows the page list, opens a page with a way back, and finds the Git provider page", async () => {
    phone();
    await mount("/settings");
    const list = () =>
      screen.getByRole("navigation", { name: en("ui.screens-contents.settings-settings") });
    expect(list()).toBeInTheDocument();
    await userEvent.click(within(list()).getByRole("button", { name: /Atlas AI/ }));
    expect(where()).toBe("/settings/ai");
    expect(
      screen.queryByRole("navigation", { name: en("ui.screens-contents.settings-settings") }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Settings/ }));
    expect(list()).toBeInTheDocument();
    await userEvent.type(
      screen.getByRole("searchbox", {
        name: en("ui.screens-contents.settings-search-settings"),
      }),
      "provider",
    );
    expect(within(list()).getByRole("button", { name: /Git provider/ })).toBeInTheDocument();
    expect(within(list()).queryByRole("button", { name: /Atlas AI/ })).toBeNull();
  });
});

describe("the AI page", () => {
  it("states the isolation as the host reports it: the flag and what it leaves out", async () => {
    await mount(
      "/settings/ai",
      aiReaders({
        ...SIGNED_IN,
        isolation: {
          flag: '--setting-sources ""',
          drops: ["hooks", "plugins", "mcp", "instructions"],
        },
      }),
    );
    const line = await screen.findByTestId("ai-isolation");
    expect(line).toHaveTextContent('--setting-sources ""');
    expect(line).toHaveTextContent(
      "the agent starts without: hooks, plugins, MCP servers, CLAUDE.md",
    );
    // A statement, not a choice: the follow switch stays the page's only switch.
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("says nothing about an isolation the host did not report", async () => {
    await mount("/settings/ai", aiReaders(SIGNED_IN));
    await screen.findByTestId("ai-ready");
    expect(screen.queryByTestId("ai-isolation")).toBeNull();
  });
});
