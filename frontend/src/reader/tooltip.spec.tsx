/** The tooltip as the reader meets it in the running Atlas shell: the
 * keyboard reaches an icon button's explanation, the mouse reaches a "not
 * measured" mark's, and Escape takes either away. Placement inside the window
 * is measured in Chromium (runTooltipContract); jsdom computes no layout. */

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { uiT } from "./testing";

const model = taskflowModel();
const tt = uiT("en");

function mount(m = model) {
  window.history.replaceState(null, "", "/");
  return render(<Atlas model={m} readers={null} />);
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

describe("the tooltip in the Atlas shell", () => {
  it("shows nothing until a control is hovered or reached", () => {
    mount();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("explains an icon button to the keyboard at once, and goes away on Escape", async () => {
    const user = userEvent.setup();
    mount();
    const history = screen.getByRole("button", { name: "History" });
    // Tab until the history button has the focus; it sits in the top bar's first group.
    for (let i = 0; i < 10 && document.activeElement !== history; i++) await user.tab();
    expect(history).toHaveFocus();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("History");
    expect(tip).toHaveAttribute("data-ready", "yes");
    // The browser's own tooltip is suppressed: the title moved to data-tip.
    expect(history).not.toHaveAttribute("title");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(history).toHaveFocus();
  });

  it("explains a not-measured mark to the mouse after the delay, and describes it", () => {
    jest.useFakeTimers();
    try {
      const unscanned = { ...model, scan: { ...model.scan, loc: undefined } } as typeof model;
      mount(unscanned);
      const loc = screen.getByTestId("overview-loc");
      // Precondition: the figure was not measured and says so in its title.
      expect(loc).toHaveAttribute("title", tt("ui.screens-frame.overviewpage-not-measured"));
      fireEvent.mouseOver(loc);
      act(() => {
        jest.advanceTimersByTime(349);
      });
      // In the tree to be measured, but neither seen nor read yet.
      const measured = document.querySelector<HTMLElement>('[role="tooltip"]');
      expect(measured).toHaveAttribute("aria-hidden", "true");
      expect(measured).not.toBeVisible();
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      act(() => {
        jest.advanceTimersByTime(1);
      });
      const tip = screen.getByRole("tooltip");
      expect(tip).toHaveTextContent(tt("ui.screens-frame.overviewpage-not-measured"));
      expect(loc.getAttribute("aria-describedby")).toBe(tip.id);
      fireEvent.mouseOut(loc, { relatedTarget: document.body });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      expect(loc).not.toHaveAttribute("aria-describedby");
    } finally {
      jest.useRealTimers();
    }
  });

  it("says nothing about a control with nothing to say", () => {
    jest.useFakeTimers();
    try {
      mount();
      const role = screen.getByRole("button", { name: tt("shell.role.dev.name") });
      // Precondition: the control carries no title to show.
      expect(role).not.toHaveAttribute("title");
      fireEvent.mouseOver(role);
      act(() => {
        jest.advanceTimersByTime(400);
      });
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ["the mouse leaves", (el: HTMLElement) => fireEvent.mouseOut(el, { relatedTarget: null })],
    ["focus moves on", (el: HTMLElement) => fireEvent.focusOut(el)],
    ["Escape is pressed", () => fireEvent.keyDown(document, { key: "Escape" })],
    ["something scrolls", () => fireEvent.scroll(document)],
    ["the control is pressed", (el: HTMLElement) => fireEvent.mouseDown(el)],
    ["the window resizes", () => fireEvent(window, new Event("resize"))],
  ])("goes away when %s, and the control clears its tooltip reference", (_, leave) => {
    jest.useFakeTimers();
    try {
      mount({ ...model, scan: { ...model.scan, loc: undefined } } as typeof model);
      const loc = screen.getByTestId("overview-loc");
      fireEvent.mouseOver(loc);
      act(() => {
        jest.advanceTimersByTime(400);
      });
      // Precondition: it was shown and pointed at.
      expect(screen.getByRole("tooltip")).toBeVisible();
      expect(loc).toHaveAttribute("aria-describedby");
      act(() => leave(loc));
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      expect(loc).not.toHaveAttribute("aria-describedby");
    } finally {
      jest.useRealTimers();
    }
  });
});
