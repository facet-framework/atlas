/** Atlas at phone width: the rendered app with the mobile media query on.
 * Every place and every control the desktop bar offers has to be reachable
 * from the tab bar, the "More" sheet, the compact top bar or the chat. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { uiT } from "./testing";

const model = taskflowModel();
const tt = uiT("en");
const realMatchMedia = window.matchMedia;

function phone() {
  window.matchMedia = ((query: string) => ({
    matches: query === "(max-width: 767px)" || query === "(max-height: 500px)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function mount(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={null} />);
}

const where = () => window.location.pathname;
const tabbar = () => screen.getByRole("navigation", { name: tt("shell.nav.label") });
const more = () => screen.getByRole("dialog", { name: tt("shell.more.title") });

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  phone();
});

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("Atlas on a phone", () => {
  it("draws the mobile layout with a tab bar, no nav bar and a compact top bar", () => {
    const { container } = mount("/");
    expect(container.querySelector("[data-layout]")).toHaveAttribute("data-layout", "mobile");
    expect(within(tabbar()).getAllByRole("button")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: tt("shell.top.settings") })).toBeNull();
    expect(screen.getByRole("button", { name: tt("shell.top.goTo") })).toBeInTheDocument();
  });

  it("shows one Ask action in the tab bar and no floating Ask pill", () => {
    mount("/");
    expect(within(tabbar()).getAllByRole("button", { name: tt("shell.tab.ask") })).toHaveLength(1);
    expect(screen.queryByTestId("chat-pill")).toBeNull();
  });

  it("marks the top and tab bars for the compact mobile layout", () => {
    expect(window.matchMedia("(max-height: 500px)").matches).toBe(true);
    const { container } = mount("/");
    expect(within(screen.getByTestId("shell-head")).getByRole("banner")).toHaveAttribute(
      "data-compact",
    );
    expect(container.querySelector(".t-tabbar")).toBeInTheDocument();
  });

  it("reaches the first three areas from the tab bar", async () => {
    mount("/");
    await userEvent.click(
      within(tabbar()).getByRole("button", { name: tt("shell.nav.item.product") }),
    );
    expect(where()).toBe("/product");
    await userEvent.click(
      within(tabbar()).getByRole("button", { name: tt("shell.nav.item.records") }),
    );
    expect(where()).toBe("/records");
    await userEvent.click(
      within(tabbar()).getByRole("button", { name: tt("shell.nav.item.overview") }),
    );
    expect(where()).toBe("/");
  });

  it("reaches every other area from the More sheet", async () => {
    mount("/");
    const rest = [
      ["shell.nav.item.contents", "/contents"],
      ["shell.nav.item.glossary", "/glossary"],
      ["shell.nav.item.adr", "/p/adr"],
      ["shell.nav.item.bpmn", "/p/bpmn"],
    ] as const;
    for (const [key, path] of rest) {
      await userEvent.click(within(tabbar()).getByRole("button", { name: tt("shell.tab.more") }));
      const name = path.startsWith("/p/") ? `${tt(key)} · ${tt("shell.nav.plugin")}` : tt(key);
      await userEvent.click(within(more()).getByRole("button", { name }));
      expect(where()).toBe(path);
      expect(screen.queryByRole("dialog", { name: tt("shell.more.title") })).toBeNull();
    }
  });

  it("reaches settings, the reader role and the theme from the More sheet", async () => {
    const { container } = mount("/");
    const app = container.querySelector("[data-t-mode]") as HTMLElement;
    const before = app.dataset.tMode;
    await userEvent.click(screen.getByRole("button", { name: "Menu" }));
    const sheet = more();
    // A text button that names the other scheme.
    const other = before === "light" ? tt("shell.theme.dark") : tt("shell.theme.light");
    const scheme = within(sheet).getByRole("button", { name: other });
    expect(scheme).toHaveTextContent(other);
    await userEvent.click(scheme);
    expect(app.dataset.tMode).not.toBe(before);

    const roles = within(more()).getByRole("radiogroup", { name: tt("shell.role.label") });
    const author = within(roles).getByRole("radio", { name: tt("shell.role.author.name") });
    expect(author).toHaveAttribute("aria-checked", "false");
    await userEvent.click(author);
    expect(screen.getByTestId("overview")).toHaveAttribute("data-role", "author");

    await userEvent.click(within(tabbar()).getByRole("button", { name: tt("shell.tab.more") }));
    await userEvent.click(within(more()).getByRole("button", { name: tt("shell.top.settings") }));
    expect(where()).toBe("/settings");
  });

  it("opens the chat full screen from the tab bar, reaches the session list, and closes", async () => {
    mount("/");
    await userEvent.click(within(tabbar()).getByRole("button", { name: tt("shell.tab.ask") }));
    const full = screen.getByRole("region", { name: tt("ui.screens-plugins.chat-ask-atlas") });
    expect(full).toHaveAttribute("data-mobile", "true");
    await userEvent.click(
      within(full).getByRole("button", { name: tt("ui.screens-plugins.chat-sessions") }),
    );
    expect(
      screen.getByRole("dialog", { name: tt("ui.screens-plugins.chat-sessions") }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(
        screen.getByRole("dialog", { name: tt("ui.screens-plugins.chat-sessions") }),
      ).getByRole("button", {
        name: tt("primitives.overlay.close"),
      }),
    );
    expect(
      screen.queryByRole("dialog", { name: tt("ui.screens-plugins.chat-sessions") }),
    ).toBeNull();
    await userEvent.click(
      within(full).getByRole("button", { name: tt("ui.screens-plugins.chat-close") }),
    );
    expect(
      screen.queryByRole("region", { name: tt("ui.screens-plugins.chat-ask-atlas") }),
    ).toBeNull();
  });

  it("opens the palette from the compact top bar and jumps to a record", async () => {
    mount("/");
    await userEvent.click(screen.getByRole("button", { name: tt("shell.top.goTo") }));
    await userEvent.type(screen.getByRole("combobox"), "quick-add");
    await userEvent.keyboard("{Enter}");
    expect(where()).toBe("/record/tasks/create/quick-add");
  });
});
