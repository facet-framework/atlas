/** The surfaces an app opens for contributions it does not know in advance —
 * the doors, settings pages, tiles and conversation modes Atlas plugins bring.
 * Each case renders the component and looks where the
 * contribution has to land, not at a returned value. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { SettingsPage } from "./contents/Settings";
import { ContentsHub } from "./contents/Hub";
import { Composer } from "./plugins/Chat";

describe("plugin surfaces of the pages", () => {
  it("lists plugin pages in their own group and reports the picked one", () => {
    const onPluginSection = jest.fn();
    render(
      <SettingsPage
        active="plugin-docs"
        query=""
        pluginSections={[{ key: "plugin-docs", name: "Documentation", sub: "Sources" }]}
        onPluginSection={onPluginSection}
      >
        <p>page body</p>
      </SettingsPage>,
    );
    const group = screen.getByTestId("settings-plugin-sections");
    const item = within(group).getByRole("button", { name: /Documentation/ });
    expect(item).toHaveAttribute("aria-current", "page");
    fireEvent.click(item);
    expect(onPluginSection).toHaveBeenCalledWith("plugin-docs");
    // The open section is named after the plugin's page.
    expect(screen.getByLabelText("Documentation")).toHaveTextContent("page body");
  });

  it("hides a plugin page the search does not match", () => {
    render(
      <SettingsPage
        active="appearance"
        query="theme"
        results={["appearance"]}
        pluginSections={[{ key: "plugin-docs", name: "Documentation", sub: "Sources" }]}
      />,
    );
    expect(screen.queryByTestId("settings-plugin-sections")).not.toBeInTheDocument();
  });

  it("draws plugin tiles in a Plugins group with an unmeasured count as a dash", () => {
    const onOpenPlugin = jest.fn();
    render(
      <ContentsHub
        state="ready"
        kinds={[]}
        plugins={[
          { key: "notes", label: "Notes", icon: "file", desc: "Pages", count: null, unit: "" },
        ]}
        onOpenPlugin={onOpenPlugin}
      />,
    );
    const tile = within(screen.getByTestId("hub-group-Plugins")).getByTestId("kind-notes");
    expect(tile).toHaveTextContent("—");
    fireEvent.click(within(tile).getByRole("button", { name: /Notes/ }));
    expect(onOpenPlugin).toHaveBeenCalledWith("notes");
  });

  it("offers the modes it is given and reports the chosen key", () => {
    const onMode = jest.fn();
    render(
      <Composer
        value=""
        mode="normal"
        model="Opus"
        context={[]}
        modes={[
          { key: "normal", label: "Ask" },
          { key: "review", label: "Review", icon: "edit" },
        ]}
        onMode={onMode}
      />,
    );
    const group = screen.getByRole("radiogroup");
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Ask", "Review"]);
    expect(within(group).getByRole("radio", { name: "Ask" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(within(group).getByRole("radio", { name: "Review" }));
    expect(onMode).toHaveBeenCalledWith("review");
  });
});
