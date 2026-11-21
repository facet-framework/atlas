import { fireEvent, screen, within } from "@testing-library/react";
import { renderInEnglish as render, renderInEnglish } from "../testing";
import {
  AiSection,
  GitProviderSection,
  GenUiSection,
  LanguageSection,
  PluginDetailSection,
  PluginGrantSection,
  PluginsSection,
  SettingsPage,
  StorageSection,
  ThemeSection,
  type AiSettings,
  type GitProviderSettings,
} from "./Settings";
import { grantItems, plugins } from "./data.spec-support";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cssC = readFileSync(join(__dirname, "..", "styles", "contents.css"), "utf8");

describe("SettingsPage", () => {
  it("lists sections beside the open one and reports a pick", () => {
    const onSection = jest.fn();
    render(
      <SettingsPage
        active="language"
        query=""
        badges={{ plugins: { label: "5 open", tone: "warn" }, ai: { label: "x" } }}
        onSection={onSection}
      >
        <p>Content</p>
      </SettingsPage>,
    );
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(within(nav).getByRole("button", { name: /Language/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByText("5 open")).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole("button", { name: /Plugins/ }));
    expect(onSection).toHaveBeenCalledWith("plugins");
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("filters by query and offers a way out when nothing matches", () => {
    const onQuery = jest.fn();
    const { rerender } = render(
      <SettingsPage active="appearance" query="Spr" results={["language"]} onQuery={onQuery}>
        <p>Content</p>
      </SettingsPage>,
    );
    expect(within(screen.getByRole("navigation")).getAllByRole("listitem")).toHaveLength(1);
    rerender(
      <SettingsPage active="appearance" query="Keyboard shortcuts" results={[]} onQuery={onQuery}>
        <p>Content</p>
      </SettingsPage>,
    );
    const none = screen.getByTestId("settings-no-results");
    expect(none).toHaveTextContent("No setting for “Keyboard shortcuts”");
    expect(screen.queryByText("Content")).not.toBeInTheDocument();
    fireEvent.click(within(none).getByRole("button", { name: "Clear search" }));
    fireEvent.click(within(none).getByRole("button", { name: "Plugins" }));
    expect(onQuery.mock.calls).toEqual([[""], ["Plugins"]]);
  });

  it("goes from list to detail and back on mobile", () => {
    const onBack = jest.fn();
    const { rerender } = render(
      <SettingsPage active="ai" mobile query="">
        <p>Detail</p>
      </SettingsPage>,
    );
    expect(screen.queryByText("Detail")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    rerender(
      <SettingsPage active="ai" mobile detailOpen query="" onBack={onBack}>
        <p>Detail</p>
      </SettingsPage>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByText("Detail")).toBeInTheDocument();
  });
});

describe("sections", () => {
  it("previews all four palettes live and switches palette, density, motion and surface", () => {
    const onChange = jest.fn();
    render(
      <ThemeSection
        value={{
          theme: "facet",
          mode: "dark",
          followSystem: false,
          density: "normal",
          motion: "system",
        }}
        onChange={onChange}
      />,
    );
    const palettes = within(screen.getByTestId("theme-palettes")).getAllByRole("radio");
    expect(palettes).toHaveLength(4);
    expect(palettes[0]).toHaveAttribute("aria-checked", "true");
    fireEvent.click(palettes[3]);
    fireEvent.click(screen.getByRole("switch", { name: "Follow the system" }));
    fireEvent.click(screen.getByRole("radio", { name: "Wide" }));
    fireEvent.click(screen.getByRole("radio", { name: "Reduced" }));
    // The reader has one surface: the appearance page offers no surface choice.
    expect(screen.queryByRole("radio", { name: "derived" })).not.toBeInTheDocument();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { theme: "paper", mode: "light" },
      { followSystem: true },
      { density: "spacious" },
      { motion: "reduced" },
    ]);
  });

  it("changes language settings and previews dates in the chosen form", () => {
    const onChange = jest.fn();
    const sample = { relative: "6 days ago", absolute: "2026-11-06", number: "1.226" };
    const value = {
      ui: "de" as const,
      content: "record" as const,
      dates: "relative" as const,
      week: "monday" as const,
    };
    const { rerender } = render(
      <LanguageSection value={value} sample={sample} onChange={onChange} />,
    );
    expect(screen.getByTestId("language-preview")).toHaveTextContent("6 days ago");
    // A FACET segment, labelled with what it switches, not a native drop-down.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const ui = screen.getByRole("radiogroup", { name: "Interface language" });
    expect(within(ui).getByRole("radio", { name: "German" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByText("Interface language", { selector: ".t-c-setrow__label" }),
    ).toBeVisible();
    fireEvent.click(within(ui).getByRole("radio", { name: "English" }));
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Content language" })).getByRole("radio", {
        name: "English",
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "11/10/2026" }));
    fireEvent.click(screen.getByRole("radio", { name: "Sunday" }));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { ui: "en" },
      { content: "en" },
      { dates: "absolute" },
      { week: "sunday" },
    ]);
    rerender(<LanguageSection value={{ ...value, dates: "absolute" }} sample={sample} />);
    expect(screen.getByTestId("language-preview")).toHaveTextContent("2026-11-06");
  });

  it("shows stored keys with sizes, validates the history limit and clears", () => {
    const onChange = jest.fn();
    const onClear = jest.fn();
    render(
      <StorageSection
        value={{
          historyLimit: "500",
          historyCount: 37,
          keepChat: true,
          restoreLast: false,
          error: "A whole number from 1 to 200.",
          items: [{ key: "atlas.chat", label: "Chat", bytes: 2048, entries: 3 }],
        }}
        onChange={onChange}
        onClear={onClear}
      />,
    );
    expect(screen.getByText("A whole number from 1 to 200.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Maximum"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("switch", { name: "Restore place" }));
    fireEvent.click(screen.getByRole("switch", { name: "Keep chat sessions" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear Chat (3 entries)" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all 1 · 2.0 KB" }));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { historyLimit: "100" },
      { restoreLast: true },
      { keepChat: false },
    ]);
    expect(onClear.mock.calls).toEqual([["atlas.chat"], ["*"]]);
    expect(screen.getByText("Saved in this browser · 2.0 KB")).toBeInTheDocument();
  });

  it("names what each stored key holds and what its button clears", () => {
    const onClear = jest.fn();
    const { rerender } = render(
      <StorageSection
        value={{
          historyLimit: "200",
          historyCount: 4,
          keepChat: true,
          restoreLast: true,
          items: [
            {
              key: "facet.atlas.history",
              label: "History of places",
              bytes: 400,
              entries: 4,
              contents: "4 places",
            },
            {
              key: "facet.atlas.state",
              label: "Chat-Sessions",
              bytes: 900,
              entries: 1,
              contents: "2 Sessions",
            },
          ],
        }}
        onClear={onClear}
      />,
    );
    const rows = screen.getAllByTestId("storage-item");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("History of places");
    expect(within(rows[0]).getByTestId("storage-item-contents")).toHaveTextContent("4 places");
    expect(rows[0]).toHaveTextContent("facet.atlas.history");
    expect(within(rows[1]).getByTestId("storage-item-contents")).toHaveTextContent("2 Sessions");
    fireEvent.click(
      within(rows[1]).getByRole("button", { name: "Clear Chat-Sessions (2 Sessions)" }),
    );
    expect(onClear).toHaveBeenCalledWith("facet.atlas.state");
    rerender(
      <StorageSection
        value={{
          historyLimit: "200",
          historyCount: 0,
          keepChat: true,
          restoreLast: true,
          items: [],
        }}
        onClear={onClear}
      />,
    );
    expect(screen.getByRole("button", { name: /Clear all 0/ })).toBeDisabled();
  });

  it("offers focus mode under appearance only where the app has it", () => {
    const onChange = jest.fn();
    const base = {
      theme: "facet" as const,
      mode: "dark" as const,
      followSystem: false,
      density: "normal" as const,
      motion: "system" as const,
    };
    const { rerender } = render(<ThemeSection value={base} onChange={onChange} />);
    expect(screen.queryByRole("switch", { name: "Focus mode" })).not.toBeInTheDocument();
    rerender(<ThemeSection value={{ ...base, focus: false }} onChange={onChange} />);
    const focus = screen.getByRole("switch", { name: "Focus mode" });
    expect(focus).toHaveAttribute("aria-checked", "false");
    fireEvent.click(focus);
    expect(onChange).toHaveBeenLastCalledWith({ focus: true });
  });

  it("says per tool whether its state is settled, changeable or unmeasured", () => {
    render(
      <AiSection
        value={{
          ...ai,
          tools: [
            { name: "Read", allowed: true, fixed: true },
            { name: "mcp__facet__notes_find", allowed: true, fixed: false },
            { name: "Bash", allowed: false, fixed: true },
            { name: "New", allowed: false },
          ],
        }}
      />,
    );
    const row = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
    expect(within(row("Read")).getByTestId("ai-tool-change")).toHaveTextContent("settled");
    expect(within(row("Bash")).getByTestId("ai-tool-change")).toHaveTextContent("settled");
    expect(within(row("mcp__facet__notes_find")).getByTestId("ai-tool-change")).toHaveTextContent(
      "changeable",
    );
    const unknown = within(row("New")).getByTestId("ai-tool-change");
    expect(unknown).toHaveTextContent("—");
    expect(unknown).toHaveAttribute("title", "not measured");
  });

  const ai: AiSettings = {
    state: "ready",
    account: "lokal",
    model: "Opus",
    models: ["Opus", "Sonnet"],
    mode: "read",
    tools: [
      { name: "Read", allowed: true },
      { name: "Bash", allowed: false },
    ],
    lastCheck: "14:08",
  };

  it("shows the signed-in agent with its tools, and the login command when signed out", () => {
    const onChange = jest.fn();
    const onCopy = jest.fn();
    const onCheck = jest.fn();
    const { rerender } = render(<AiSection value={ai} onChange={onChange} onCheck={onCheck} />);
    expect(screen.getByTestId("ai-ready")).toHaveTextContent("Signed in");
    expect(screen.getByText("blocked")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Model" }), {
      target: { value: "Sonnet" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Explain" }));
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { model: "Sonnet" },
      { mode: "explain" },
    ]);
    expect(onCheck).toHaveBeenCalled();
    rerender(
      <AiSection value={{ ...ai, state: "signed-out" }} onChange={onChange} onCopy={onCopy} />,
    );
    const out = screen.getByTestId("ai-signed-out");
    expect(out).toHaveTextContent("$ claude login");
    fireEvent.click(within(out).getByRole("button", { name: "Copy command" }));
    expect(onCopy).toHaveBeenCalledWith("claude login");
  });

  const forge: GitProviderSettings = {
    state: "ok",
    remote: "https://github.com/o/r.git",
    provider: "github",
    branch: "main",
    branchPrefix: "atlas/",
    prDraft: true,
    codeLinks: true,
    manualUrl: "",
  };

  it("shows the detected remote, and asks for a URL with validation without one", () => {
    const onChange = jest.fn();
    const onTest = jest.fn();
    const { rerender } = render(
      <GitProviderSection value={forge} onChange={onChange} onTest={onTest} />,
    );
    expect(screen.getByText("https://github.com/o/r.git")).toBeInTheDocument();
    // The detected values sit in a settings card like every other row: the card's
    // rule gives the list the same inner spacing as a setting row (16px each side).
    const kv = screen.getByText("https://github.com/o/r.git").closest("dl") as HTMLElement;
    expect(kv.parentElement).toHaveClass("t-c-setgroup");
    const rule = /\n\.t-c-setgroup > \.t-c-kv \{([^}]*)\}/.exec(cssC)?.[1] ?? "";
    expect(rule).toMatch(/padding:\s*\d+px 16px/);
    const row = /\n\.t-c-setrow \{([^}]*)\}/.exec(cssC)?.[1] ?? "";
    expect(row).toMatch(/padding:\s*12px 16px/);
    fireEvent.click(screen.getByRole("radio", { name: "GitLab" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Prefix for proposal branches" }), {
      target: { value: "x/" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "As draft" }));
    fireEvent.click(screen.getByRole("switch", { name: "Link code references" }));
    fireEvent.click(screen.getByRole("button", { name: "Test link" }));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { provider: "gitlab" },
      { branchPrefix: "x/" },
      { prDraft: false },
      { codeLinks: false },
    ]);
    expect(onTest).toHaveBeenCalled();
    rerender(
      <GitProviderSection
        value={{
          ...forge,
          state: "no-remote",
          manualUrl: "github.com",
          error: "Enter a complete URL starting with https://.",
        }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId("git-provider-no-remote")).toHaveTextContent("No remote set");
    expect(screen.getByText("Enter a complete URL starting with https://.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://x/y" } });
    expect(onChange).toHaveBeenLastCalledWith({ manualUrl: "https://x/y" });
    rerender(<GitProviderSection value={{ ...forge, state: "no-remote", manualUrl: "" }} />);
    expect(screen.getByRole("button", { name: "Test link" })).toBeDisabled();
  });

  it("lists plugins with checksum state and open grants", () => {
    const onOpen = jest.fn();
    const onToggle = jest.fn();
    render(<PluginsSection plugins={plugins} onOpen={onOpen} onToggle={onToggle} />);
    expect(screen.getByText("3 grants open")).toBeInTheDocument();
    expect(screen.getByText("without checksum")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Processes" }));
    fireEvent.click(screen.getByRole("switch", { name: "Switch on Decisions" }));
    expect(onOpen).toHaveBeenCalledWith("bpmn");
    expect(onToggle).toHaveBeenCalledWith("adr", false);
  });

  it("shows a plugin's package, what it requests and what is granted, with the grant command", () => {
    const onCopy = jest.fn();
    const onOpenGrant = jest.fn();
    const onBack = jest.fn();
    const bpmn = { ...plugins.find((p) => p.id === "bpmn")!, verification: "mismatch" as const };
    const manifest = {
      entry: "dist/bpmn.js",
      path: ".facet/plugins/bpmn/",
      installedAt: "2026-11-02",
      sidecars: [{ name: "bpmn", sha256: "3f9c1be04a7d22c5e8a9b0f61d7735e2" }],
    };
    const { rerender } = render(
      <PluginDetailSection
        plugin={bpmn}
        manifest={manifest}
        grants={grantItems}
        onCopy={onCopy}
        onOpenGrant={onOpenGrant}
        onBack={onBack}
      />,
    );
    expect(screen.getByText("Checksum differs")).toBeInTheDocument();
    expect(within(screen.getByTestId("grant-g3")).getByText("open")).toBeInTheDocument();
    const open = screen.getByTestId("plugin-open-grants");
    expect(open).toHaveTextContent("$ facet plugin grant bpmn");
    fireEvent.click(within(open).getByRole("button", { name: "Copy command" }));
    fireEvent.click(within(open).getByRole("button", { name: "Open the grant page" }));
    fireEvent.click(screen.getByRole("button", { name: "All plugins" }));
    expect(onCopy).toHaveBeenCalledWith("facet plugin grant bpmn");
    expect(onOpenGrant).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
    rerender(
      <PluginDetailSection
        plugin={plugins[0]}
        manifest={manifest}
        grants={grantItems.map((g) => ({
          ...g,
          state: g.key === "g3" ? ("refuses" as const) : ("granted" as const),
        }))}
      />,
    );
    expect(screen.queryByTestId("plugin-open-grants")).not.toBeInTheDocument();
    expect(screen.getByText("denied")).toBeInTheDocument();
  });

  it("lets every requested right be granted or denied, and saves only when all are decided", () => {
    const onDecide = jest.fn();
    const onConfirm = jest.fn();
    const token = { valid: true, until: "14:32", origin: "http://127.0.0.1:47811" };
    const { rerender } = render(
      <PluginGrantSection
        plugin={plugins[2]}
        items={grantItems}
        decisions={{ g3: "grant" }}
        token={token}
        onDecide={onDecide}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("button", { name: "Save decision" })).toBeDisabled();
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Decide repo.commit" })).getByRole("radio", {
        name: "Deny",
      }),
    );
    expect(onDecide).toHaveBeenCalledWith("g3", "deny");
    const all = Object.fromEntries(grantItems.map((g) => [g.key, "grant" as const]));
    rerender(
      <PluginGrantSection
        plugin={plugins[2]}
        items={grantItems}
        decisions={all}
        token={token}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
    expect(onConfirm).toHaveBeenCalled();
    rerender(
      <PluginGrantSection
        plugin={plugins[2]}
        items={grantItems}
        decisions={{}}
        token={{ ...token, valid: false }}
      />,
    );
    expect(screen.getByTestId("grant-token")).toHaveTextContent("no one-time token");
    expect(screen.queryByRole("radio", { name: "Grant" })).not.toBeInTheDocument();
  });

  it("switches generative UI surfaces and validates the block limit", () => {
    const onChange = jest.fn();
    const value = {
      enabled: true,
      scope: "components" as const,
      maxBlocks: "40",
      error: "1 to 12 Blocks.",
      surfaces: [{ key: "chat", label: "Ask Atlas", desc: "d", on: true }],
    };
    const { rerender } = render(<GenUiSection value={value} onChange={onChange} />);
    expect(screen.getByText("1 to 12 Blocks.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Ask Atlas" }));
    fireEvent.click(screen.getByRole("radio", { name: "Free" }));
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("switch", { name: "Views in answers" }));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { surfaces: [{ ...value.surfaces[0], on: false }] },
      { scope: "free" },
      { maxBlocks: "6" },
      { enabled: false },
    ]);
    rerender(<GenUiSection value={{ ...value, enabled: false }} />);
    expect(screen.getByRole("switch", { name: "Ask Atlas" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

describe("English", () => {
  it("names the sections and the grant states in English without a provider", () => {
    renderInEnglish(
      <SettingsPage active="appearance" query="">
        <span />
      </SettingsPage>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search settings" })).toBeInTheDocument();
    expect(screen.getByText("History & storage")).toBeInTheDocument();
    expect(screen.getByText("Atlas AI")).toBeInTheDocument();
  });

  it("speaks English in the plugin list", () => {
    renderInEnglish(<PluginsSection plugins={plugins} />);
    expect(screen.getByRole("heading", { name: "Plugins" })).toBeInTheDocument();
    expect(screen.getAllByText("Checksum ok").length).toBeGreaterThan(0);
    expect(screen.getByText("Install and grant in the terminal.")).toBeInTheDocument();
  });
});
