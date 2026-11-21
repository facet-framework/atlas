import { germanLabel } from "@/i18n/testing-labels.spec-support";
import { createText as componentText } from "../component-text";
/** Settings carry what the derived settings did where it still holds: the
 * colour scheme follows the system until somebody chooses, a language file
 * becomes an option, a host-backed page claims nothing without an answer, and
 * the AI page offers no control the host never sees. Each case mounts the
 * whole surface and reads the rendered page. */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import i18n from "@/i18n";
import en from "@/i18n/locales/en.json";
import Atlas from "./Atlas";
import { StorageSection } from "@/screens/contents/Settings";
import type { HostReaders } from "./host";
import { THEME_KEY } from "./useAtlas";
import { PREFERENCES_KEY } from "./preferences";
import { atlasT, uiT } from "./testing";

// Explicit keys let computed lookups follow source moves.
const I18N_LABELS: Record<string, string> = {
  one: "ui.screens-contents.settings-count-entries-one",
  other: "ui.screens-contents.settings-count-entries-other",
};

/** The default language's words; `de` is the German a case switches to. */
const t = uiT("en");
const de = uiT("de");
const realMatchMedia = window.matchMedia;
let systemLight = false;
const schemeListeners: ((e: MediaQueryListEvent) => void)[] = [];

/** A browser whose colour scheme is `systemLight`, and which reports a change to it. */
function scheme() {
  window.matchMedia = ((query: string) => ({
    matches: query === "(prefers-color-scheme: light)" ? systemLight : false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => {
      if (query === "(prefers-color-scheme: light)") schemeListeners.push(l);
    },
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

let mounted: ReturnType<typeof render> | null = null;

function mount(path: string, readers: HostReaders | null = null) {
  mounted?.unmount();
  window.history.replaceState(null, "", path);
  mounted = render(<Atlas model={taskflowModel()} readers={readers} />);
  return mounted;
}

const shell = () => screen.getByTestId("app-shell");
const where = () => window.location.pathname;

const switchTo = (lng: string) =>
  act(async () => {
    await i18n.changeLanguage(lng);
  });

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  systemLight = false;
  schemeListeners.length = 0;
  scheme();
});

afterEach(async () => {
  mounted?.unmount();
  mounted = null;
  window.matchMedia = realMatchMedia;
  await act(async () => {
    await i18n.changeLanguage("en");
  });
});

/** Colour scheme -------------------------------------------------------------------- */

describe("the colour scheme", () => {
  it("follows the system while nobody chose, and the settings show what is drawn", () => {
    systemLight = false;
    mount("/settings/appearance");
    expect(shell()).toHaveAttribute("data-t-mode", "dark");
    expect(screen.getByRole("radio", { name: "FACET · dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByRole("switch", { name: t("ui.screens-contents.settings-follow-system") }),
    ).toBeChecked();
    act(() => schemeListeners.forEach((l) => l({ matches: true } as MediaQueryListEvent)));
    expect(shell()).toHaveAttribute("data-t-mode", "light");
  });

  it("names the other scheme on the top-bar button, and pressing it asks for that scheme", async () => {
    systemLight = true;
    mount("/contents");
    const head = document.querySelector<HTMLElement>(".t-shell__head")!;
    const toDark = within(head).getByRole("button", { name: t("shell.theme.dark") });
    await userEvent.click(toDark);
    expect(shell()).toHaveAttribute("data-t-mode", "dark");
    expect(within(head).getByRole("button", { name: t("shell.theme.light") })).toBeInTheDocument();
    expect(within(head).queryByRole("button", { name: t("shell.theme.dark") })).toBeNull();
  });

  it("keeps the palette when the version switches, and a version chosen against the system ends following", async () => {
    window.localStorage.setItem(THEME_KEY, JSON.stringify({ theme: "paper", mode: "light" }));
    systemLight = true;
    mount("/settings/appearance");
    expect(shell()).toHaveAttribute("data-t-theme", "paper");
    await userEvent.click(
      within(document.querySelector<HTMLElement>(".t-shell__head")!).getByRole("button", {
        name: t("shell.theme.dark"),
      }),
    );
    expect(shell()).toHaveAttribute("data-t-theme", "paper");
    expect(shell()).toHaveAttribute("data-t-mode", "dark");
    expect(
      screen.getByRole("switch", { name: t("ui.screens-contents.settings-follow-system") }),
    ).not.toBeChecked();
    expect(JSON.parse(window.localStorage.getItem(THEME_KEY)!)).toEqual({
      theme: "paper",
      mode: "dark",
    });
  });

  it("turns following on from the settings and takes the system's version at once", async () => {
    window.localStorage.setItem(THEME_KEY, JSON.stringify({ theme: "facet", mode: "dark" }));
    systemLight = true;
    mount("/settings/appearance");
    expect(shell()).toHaveAttribute("data-t-mode", "dark");
    await userEvent.click(
      screen.getByRole("switch", { name: t("ui.screens-contents.settings-follow-system") }),
    );
    expect(shell()).toHaveAttribute("data-t-mode", "light");
    expect(JSON.parse(window.localStorage.getItem(THEME_KEY)!)).toMatchObject({ system: true });
  });

  it("offers four palette and mode combinations", async () => {
    mount("/settings/appearance");
    const cards = within(screen.getByTestId("theme-palettes")).getAllByRole("radio");
    expect(
      cards.map((c) => c.getAttribute("aria-label") ?? c.textContent?.replace(/^\d+/, "")),
    ).toEqual(["FACET · dark", "FACET · light", "Paper · dark", "Paper · light"]);
    expect(screen.queryByText(/Miro|Atlassian|Slack|IntelliJ/)).toBeNull();
    await switchTo("de");
    expect(
      screen.getByRole("radio", {
        name: `${germanLabel("Paper")} · ${germanLabel("dark")}`,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Paper · dark" })).not.toBeInTheDocument();
  });
});

/** Language ------------------------------------------------------------------------- */

/** A language file carrying every Atlas label, as an English copy with its own name. */
function languageFile(code: string, name: string, extra: Record<string, unknown> = {}) {
  const body = JSON.stringify({ code, name, translation: en, ...extra });
  return new File([body], `${code}.json`, { type: "application/json" });
}

describe("the interface language", () => {
  it("names the built-in languages in the interface language", async () => {
    mount("/settings/language");
    const group = () =>
      screen.getByRole("radiogroup", {
        name: t("ui.screens-contents.settings-interface-language"),
      });
    expect(
      within(group())
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["German", "English"]);
    await userEvent.click(within(group()).getByRole("radio", { name: "German" }));
    const german = screen.getByRole("radiogroup", {
      name: de("ui.screens-contents.settings-interface-language"),
    });
    expect(
      within(german)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual([germanLabel("German"), "English"]);
  });

  it("moves the mounted surface with the switch and back: deep labels, the role, the chat", async () => {
    mount("/contents");
    const role = (name: string) =>
      within(document.querySelector<HTMLElement>(".t-shell__head")!).queryByRole("button", {
        name: new RegExp(name),
      });
    const german = de("shell.role.dev.name");
    const english = t("shell.role.dev.name");
    expect(role(english)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Areas" })).toBeInTheDocument();
    expect(screen.getByTestId("hub-group-Evidence")).toHaveTextContent("Tests and findings");
    await act(async () => {
      await i18n.changeLanguage("de");
    });
    expect(
      screen.getByRole("navigation", { name: componentText("de").t("shell.nav.label") }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("hub-group-Evidence")).toHaveTextContent(
      i18n.getFixedT("de")("ui.screens-contents.hub-tests-findings"),
    );
    expect(role(german)).toBeInTheDocument();
    expect(role(english)).toBeNull();
    expect(screen.getAllByText(de("ui.screens-plugins.chat-ask-atlas")).length).toBeGreaterThan(0);
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(role(english)).toBeInTheDocument();
    expect(screen.getAllByText(t("ui.screens-plugins.chat-ask-atlas")).length).toBeGreaterThan(0);
  });

  it("opens the hidden picker from the add button", async () => {
    mount("/settings/language");
    const input = screen.getByTestId<HTMLInputElement>("language-file");
    expect(input).not.toBeVisible();
    const clicked = jest.fn();
    input.addEventListener("click", clicked);
    await userEvent.click(screen.getByTestId("language-add"));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("makes a language file an option under its own name and the active language, and clears the input", async () => {
    mount("/settings/language");
    const input = screen.getByTestId<HTMLInputElement>("language-file");
    fireEvent.change(input, { target: { files: [languageFile("fr", "Français")] } });
    await waitFor(() => expect(i18n.language).toBe("fr"));
    expect(input.value).toBe("");
    const group = screen.getByRole("radiogroup", {
      name: uiT("en")("ui.screens-contents.settings-interface-language"),
    });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["German", "English", "Français"]);
    expect(within(group).getByRole("radio", { name: "Français" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByTestId("language-refused")).toBeNull();
  });

  it("refuses a file that is not a language file with a sentence, loads nothing of it and clears the input", async () => {
    mount("/settings/language");
    const input = screen.getByTestId<HTMLInputElement>("language-file");
    const broken = new File(
      [JSON.stringify({ code: "xx", name: "Kaputt", translation: {} })],
      "xx.json",
    );
    fireEvent.change(input, { target: { files: [broken] } });
    await waitFor(() =>
      expect(screen.getByTestId("language-refused")).toHaveTextContent("xx.json"),
    );
    expect(input.value).toBe("");
    expect(i18n.language).toBe("en");
    expect(screen.queryByRole("radio", { name: "Kaputt" })).toBeNull();
  });

  it("carries the design system's labels a language file brings", async () => {
    mount("/contents");
    const input = () => screen.getByTestId<HTMLInputElement>("language-file");
    mount("/settings/language");
    fireEvent.change(input(), {
      target: {
        files: [languageFile("nl", "Nederlands", { facet: { "shell.nav.label": "Gebieden" } })],
      },
    });
    await waitFor(() => expect(i18n.language).toBe("nl"));
    expect(screen.getByRole("navigation", { name: "Gebieden" })).toBeInTheDocument();
  });
});

/** Settings pages ------------------------------------------------------------------- */

function readers(repo: () => Promise<never>): HostReaders {
  return {
    repo,
    agent: () => new Promise(() => undefined),
    tools: async () => ({ available: false, tools: [] }),
    installed: async () => [],
  };
}

describe("the language follows into what is already drawn", () => {
  const en = uiT("en");

  it("keeps the switch in the settings and out of the top bar, which carries the scheme button", () => {
    systemLight = true;
    mount("/");
    const head = document.querySelector<HTMLElement>(".t-shell__head")!;
    const scheme = within(head).getByRole("button", { name: t("shell.theme.dark") });
    // An icon: the name and its tooltip say the other scheme, no word stands in the bar.
    expect(scheme.textContent?.trim()).toBe("");
    expect(scheme).toHaveAttribute("title", t("shell.theme.dark"));
    expect(within(head).queryByRole("radiogroup")).toBeNull();
    expect(within(head).queryByRole("radio")).toBeNull();
    expect(
      within(head).queryByRole("button", {
        name: new RegExp(
          [
            atlasT("de")("ui.screens-contents.settings-language"),
            "Language",
            "German",
            "English",
          ].join("|"),
        ),
      }),
    ).toBeNull();
    // The switch itself is in the settings.
    mount("/settings/language");
    expect(
      screen.getByRole("radiogroup", {
        name: t("ui.screens-contents.settings-interface-language"),
      }),
    ).toBeInTheDocument();
  });

  it("words an open role menu anew when the language changes, and back", async () => {
    mount("/");
    const head = () => document.querySelector<HTMLElement>(".t-shell__head")!;
    await userEvent.click(within(head()).getByRole("button", { name: en("shell.role.dev.name") }));
    const names = () =>
      within(screen.getByRole("menu"))
        .getAllByRole("menuitemradio")
        .map((r) => r.textContent ?? "");
    const english = names();
    expect(english.some((n) => n.startsWith(en("shell.role.dev.name")))).toBe(true);
    await switchTo("de");
    const german = names();
    expect(german).toHaveLength(english.length);
    expect(german.some((n) => n.startsWith(de("shell.role.dev.name")))).toBe(true);
    expect(german.some((n) => n.includes(de("shell.role.dev.purpose")))).toBe(true);
    expect(german.some((n) => n.includes(en("shell.role.dev.purpose")))).toBe(false);
    expect(within(screen.getByRole("menu")).getByText(de("shell.role.who"))).toBeInTheDocument();
    await switchTo("en");
    expect(names()).toEqual(english);
  });

  it("words a label the page derives from the model in the new language: a team-less portfolio group", async () => {
    const model = taskflowModel();
    // Every record without an owner team: the portfolio has one group, worded at render.
    model.features = model.features.map((f) => ({ ...f, team: "" }));
    mounted?.unmount();
    window.history.replaceState(null, "", "/");
    mounted = render(<Atlas model={model} readers={null} />);
    await userEvent.click(screen.getByRole("button", { name: en("shell.role.dev.name") }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Ownership/ }));
    const group = () =>
      within(screen.getByTestId("overview-owner-portfolio")).getAllByTestId("overview-owner-team");
    expect(group()).toHaveLength(1);
    const english = "No team";
    expect(group()[0]).toHaveTextContent(english);
    await switchTo("de");
    const german = atlasT("de")("ui.reader-pages.roles-no-team");
    expect(german).not.toBe(english);
    expect(group()[0]).toHaveTextContent(german);
    expect(group()[0]).not.toHaveTextContent(english);
  });
});

describe("settings pages", () => {
  it.each([
    ["en", ["0 entries", "1 entry", "1,000 entries"]],
    [
      "de",
      [0, 1, 1000].map((count) =>
        atlasT("de")(I18N_LABELS[`${count == 1 ? "one" : "other"}`], {
          count: count.toLocaleString("de-DE"),
        }),
      ),
    ],
  ] as const)("formats storage entry counts in %s", async (language, labels) => {
    await switchTo(language);
    render(
      <StorageSection
        value={{
          historyLimit: "200",
          historyCount: 0,
          keepChat: true,
          restoreLast: false,
          items: [0, 1, 1000].map((entries) => ({
            key: `unknown-${entries}`,
            label: `Unknown ${entries}`,
            bytes: 10,
            entries,
          })),
        }}
      />,
    );
    expect(screen.getAllByTestId("storage-item-contents").map((item) => item.textContent)).toEqual(
      labels,
    );
  });

  it("says the host was not asked instead of a negative finding when there is no way to it", () => {
    mount("/settings/git-provider");
    expect(screen.getByTestId("git-provider-unanswered")).toHaveTextContent(
      "No answer from the host",
    );
    expect(screen.queryByTestId("git-provider-no-remote")).toBeNull();
  });

  it("says no answer is in hand, with the reason, when the request did not come back", async () => {
    mount(
      "/settings/git-provider",
      readers(async () => {
        throw new Error("connection refused");
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("git-provider-unanswered")).toHaveTextContent("connection refused"),
    );
    expect(screen.queryByTestId("git-provider-no-remote")).toBeNull();
  });

  it("finds a page by what it settles, says when nothing matches and clears the query", async () => {
    mount("/settings");
    const search = screen.getByRole("searchbox", {
      name: t("ui.screens-contents.settings-search-settings"),
    });
    await userEvent.type(search, "density");
    const nav = screen.getByRole("navigation", {
      name: t("ui.screens-contents.settings-settings"),
    });
    expect(within(nav).getByText(t("ui.screens-contents.settings-appearance"))).toBeInTheDocument();
    expect(within(nav).queryByText(t("ui.screens-contents.settings-language"))).toBeNull();
    await userEvent.clear(search);
    await userEvent.type(search, "qqqq");
    expect(screen.getByTestId("settings-no-results")).toHaveTextContent("qqqq");
    await userEvent.click(
      screen.getByRole("button", { name: t("ui.screens-contents.settings-clear-search") }),
    );
    expect(search).toHaveValue("");
    expect(within(nav).getByText(t("ui.screens-contents.settings-language"))).toBeInTheDocument();
  });

  it("says that the appearance applies to this browser", () => {
    mount("/settings/appearance");
    expect(screen.getByText(t("ui.screens-contents.settings-applies-browser"))).toBeInTheDocument();
  });
});

/** The AI page ---------------------------------------------------------------------- */

const SIGNED_IN = {
  auth: { loggedIn: true, available: true, email: "a@b.c" },
  models: [{ id: "", label: "Default" }],
  model: "",
  allowedTools: ["Read"],
  blockedTools: ["Bash", "Write"],
  fixedTools: ["Bash", "Write"],
};

function aiReaders(agent: unknown): HostReaders {
  return {
    repo: () => new Promise(() => undefined),
    agent: async () => agent as never,
    tools: async () => ({ available: false, tools: [] }),
    installed: async () => [],
  };
}

describe("the AI page", () => {
  it("draws the follow switch as its only switch and states the tools as the host holds them", async () => {
    mount("/settings/ai", aiReaders(SIGNED_IN));
    await waitFor(() => expect(screen.getByTestId("ai-ready")).toBeInTheDocument());
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(1);
    expect(within(screen.getByTestId("chat-follow")).getByRole("switch")).toBe(switches[0]);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByTestId("ai-model")).toHaveTextContent("Default");
    const tools = screen.getAllByTestId("ai-tool-change");
    expect(tools.filter((t) => t.dataset.fixed === "true")).toHaveLength(2);
  });

  it("names no account and no sign-in when the companion did not answer", async () => {
    mount("/settings/ai", aiReaders(SIGNED_IN));
    await waitFor(() => expect(screen.getByTestId("ai-ready")).toBeInTheDocument());

    mount("/settings/ai");
    expect(screen.queryByTestId("ai-ready")).toBeNull();
    expect(screen.queryByText(/@/)).toBeNull();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("turns following the answer off and on again and stores each choice", async () => {
    mount("/settings/ai");
    const follow = within(screen.getByTestId("chat-follow")).getByRole("switch");
    const stored = () =>
      (
        JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}") as {
          followAnswer?: boolean;
        }
      ).followAnswer;
    const before =
      (follow as HTMLInputElement).checked ?? follow.getAttribute("aria-checked") === "true";
    await userEvent.click(follow);
    expect(stored()).toBe(!before);
    await userEvent.click(follow);
    expect(stored()).toBe(before);
    expect(where()).toBe("/settings/ai");
  });
});
