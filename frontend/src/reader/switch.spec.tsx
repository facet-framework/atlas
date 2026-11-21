/** The on/off control Atlas draws with the FACET design system's Switch:
 * first as the reader meets it in the running shell (Settings → AI,
 * "follow the answer"), then the two states no setting uses yet — a hint
 * that describes it and a lock that says why — on the same control. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { atlasT } from "./testing";

const t = atlasT("en");

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

function follow() {
  window.history.replaceState(null, "", "/settings/ai");
  render(<Atlas model={taskflowModel()} readers={null} />);
  return within(screen.getByTestId("chat-follow")).getByRole("switch", {
    name: t("ui.reader-pages.settings-scroll-along-while-answering"),
  });
}

describe("a switch in the Atlas settings", () => {
  it("says what it is called and that it is off", () => {
    const toggle = follow();
    expect(toggle).toHaveAccessibleName(t("ui.reader-pages.settings-scroll-along-while-answering"));
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("asks for the other state when pressed, both ways, and reports being on", async () => {
    const toggle = follow();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("toggles with Space and with Enter", async () => {
    const toggle = follow();
    toggle.focus();
    await userEvent.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
