/** What a plugin row and a plugin settings entry carry beyond name and badge:
 * whether there is anything to switch, why a plugin did not load, the
 * command that removes an installed one, and the dot on a page nobody has
 * opened yet. Each case reads the rendered row, never the row data. */

import { fireEvent, screen, within } from "@testing-library/react";
import { renderInEnglish as render } from "../testing";
import { PluginsSection, SettingsPage, SETTINGS_SECTIONS, sectionLabel } from "./Settings";
import type { PluginRow } from "./model";
import { createText } from "../text";

const tt = createText("en").t;

const bundled: PluginRow = {
  id: "notes",
  name: "Notes",
  version: "bundled",
  source: "bundled",
  enabled: true,
  verification: "ok",
  open: 0,
  desc: "",
};
const installed: PluginRow = {
  ...bundled,
  id: "sample",
  name: "Sample",
  version: "1.0.0",
  source: "installed",
  desc: "~/plugins/sample",
};
const refused: PluginRow = {
  ...installed,
  id: "broken",
  name: "Broken",
  enabled: false,
  verification: "missing",
  switchable: false,
  reason: "api-unsupported: api 9",
};

function rowOf(name: string): HTMLElement {
  const list = screen.getByRole("list", { name: "Plugins" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((li) => within(li).queryByRole("button", { name }));
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("a plugin row", () => {
  it("draws a switch for a loaded plugin and none for one that never loaded", () => {
    const onToggle = jest.fn();
    render(<PluginsSection plugins={[bundled, installed, refused]} onToggle={onToggle} />);
    expect(within(rowOf("Notes")).getByRole("switch", { name: "Switch on Notes" })).toBeChecked();
    expect(within(rowOf("Sample")).getByRole("switch", { name: "Switch on Sample" })).toBeChecked();
    expect(within(rowOf("Broken")).queryByRole("switch")).not.toBeInTheDocument();
    fireEvent.click(within(rowOf("Sample")).getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith("sample", false);
  });

  it("names why a plugin did not load on its own row, and the other rows still revision", () => {
    render(<PluginsSection plugins={[bundled, installed, refused]} />);
    expect(within(rowOf("Broken")).getByTestId("plugin-reason-broken")).toHaveTextContent(
      "api-unsupported: api 9",
    );
    expect(within(rowOf("Sample")).queryByTestId(/^plugin-reason-/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("names the command that removes an installed plugin with its own id, and none for a bundled one", () => {
    const onCopy = jest.fn();
    render(<PluginsSection plugins={[bundled, installed, refused]} onCopy={onCopy} />);
    expect(within(rowOf("Sample")).getByTestId("plugin-remove-sample")).toHaveTextContent(
      "facet plugin remove sample",
    );
    expect(within(rowOf("Broken")).getByTestId("plugin-remove-broken")).toHaveTextContent(
      "facet plugin remove broken",
    );
    expect(within(rowOf("Notes")).queryByText(/facet plugin remove/)).not.toBeInTheDocument();
  });
});

describe("a plugin's settings entry", () => {
  it("carries the new-page dot until it was opened", () => {
    const { rerender } = render(
      <SettingsPage
        active="appearance"
        query=""
        pluginSections={[
          { key: "plugin-a", name: "A page", sub: "a", fresh: true },
          { key: "plugin-b", name: "B page", sub: "b" },
        ]}
      />,
    );
    const group = screen.getByTestId("settings-plugin-sections");
    const a = within(group).getByRole("button", { name: /A page/ });
    expect(
      within(a).getByRole("img", {
        name: tt("ui.screens-contents.settings-new-settings-page"),
      }),
    ).toBeInTheDocument();
    const b = within(group).getByRole("button", { name: /B page/ });
    expect(within(b).queryByRole("img")).not.toBeInTheDocument();
    rerender(
      <SettingsPage
        active="plugin-a"
        query=""
        pluginSections={[
          { key: "plugin-a", name: "A page", sub: "a" },
          { key: "plugin-b", name: "B page", sub: "b" },
        ]}
      />,
    );
    expect(screen.queryByTestId("settings-fresh-plugin-a")).not.toBeInTheDocument();
  });

  it("lists every core section and no Plugins group when no plugin added a page", () => {
    render(<SettingsPage active="appearance" query="" pluginSections={[]} />);
    const nav = screen.getByRole("navigation", {
      name: tt("ui.screens-contents.settings-settings"),
    });
    for (const s of SETTINGS_SECTIONS)
      expect(
        within(nav).getByRole("button", { name: new RegExp(sectionLabel(s, tt as never)!) }),
      ).toBeInTheDocument();
    expect(screen.queryByTestId("settings-plugin-sections")).not.toBeInTheDocument();
  });
});
