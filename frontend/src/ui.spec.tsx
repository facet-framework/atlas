/** The pager: the two buttons under a list, and the placeholder rows under a
 * short last page. */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Pager } from "./ui";
import type { Paged } from "./state";

/** Stages the height of every box carrying a number in `data-h`. */

function withHeights() {
  const real = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const h = Number((this as HTMLElement).dataset?.h ?? 0);
    return { ...new DOMRect(0, 0, 0, h), height: h, width: 0 } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = real;
  };
}

function paged<T>(slice: T[], fill: number, pages = 2, page = 1): Paged<T> {
  return { slice, page, pages, total: slice.length + page * slice.length, fill };
}

/** A list with rows of the given heights and a pager beneath it. */
function list(heights: number[], fill: number, extra: Partial<{ rowSelector: string }> = {}) {
  return render(
    <div className="ledger">
      {heights.map((h, i) => (
        <button key={i} type="button" className="lrow" data-h={h}>
          Row {i + 1}
        </button>
      ))}
      <Pager
        name="ledger:a/b/c"
        page={paged(heights, fill)}
        onGoto={() => {}}
        rowSelector={extra.rowSelector}
      />
    </div>,
  );
}

// Mutation: replace mean * missing by mean * 0 in the placeholder height.
function placeholder(container: HTMLElement): HTMLElement | null {
  return within(container).queryByTestId("ghost");
}

/** Both buttons, driven in both directions. */

describe("Pager — the two buttons", () => {
  const backward = () => screen.getByRole("button", { name: /back/i });
  const forward = () => screen.getByRole("button", { name: /next/i });

  it("goes one page back and one page on, from the page it is on", () => {
    const seen: [string, number][] = [];
    render(
      <Pager
        name="ledger:a/b/c"
        page={paged([1, 2], 0, 3, 1)}
        onGoto={(k, p) => seen.push([k, p])}
      />,
    );

    // The precondition: both buttons are there to be pressed. On page two of
    // three neither end is reached, so neither is disabled.
    expect(backward).not.toThrow();
    expect(forward).not.toThrow();

    fireEvent.click(backward());
    fireEvent.click(forward());

    expect(seen).toEqual([
      ["ledger:a/b/c", 0],
      ["ledger:a/b/c", 2],
    ]);
  });

  it("offers no way past either end", () => {
    const { unmount } = render(<Pager name="k" page={paged([1], 0, 3, 0)} onGoto={() => {}} />);
    expect(backward()).toBeDisabled();
    expect(forward()).not.toBeDisabled();
    unmount();

    render(<Pager name="k" page={paged([1], 0, 3, 2)} onGoto={() => {}} />);
    expect(backward()).not.toBeDisabled();
    expect(forward()).toBeDisabled();
  });
});

describe("Pager — placeholder rows", () => {
  let restore: () => void;
  beforeEach(() => {
    restore = withHeights();
  });
  afterEach(() => restore());

  it("fills the short last page to the height of a full one", () => {
    // Two rows of 52 px stand there, four are missing: the placeholder carries
    // exactly those four rows. The surface then ends where it ended on every
    // previous page — and the "next" button stays where the pointer last saw
    // it.
    const { container } = list([52, 52], 4);
    expect(placeholder(container)?.style.height).toBe("208px");
  });

  it("puts no placeholder under a full page", () => {
    const { container } = list([52, 52, 52], 0);
    expect(placeholder(container)).toBeNull();
  });

  it("puts no placeholder where nothing is paged at all", () => {
    // A list that fits on one page shows no pager — and then nothing that
    // would have to hold its height either.
    const { container } = render(
      <div className="ledger">
        <button type="button" className="lrow" data-h={52}>
          Row
        </button>
        <Pager name="k" page={paged([1], 0, 1, 0)} onGoto={() => {}} />
      </div>,
    );
    expect(placeholder(container)).toBeNull();
    expect(screen.queryByRole("button", { name: /next/ })).toBeNull();
  });

  it("averages over the rows of the page instead of generalising from one", () => {
    // Rows are not equally tall: an id wraps, a note runs to two lines. The
    // last row is then a single accident — the mean of the rows actually
    // standing there is the best estimate for one that does not exist. Here:
    // (40+40+100)/3 = 60, missing three times.
    const { container } = list([40, 40, 100], 3);
    expect(placeholder(container)?.style.height).toBe("180px");
  });

  it("gives no height where nobody could measure one", () => {
    restore();
    const { container } = list([52, 52], 4);
    expect(placeholder(container)?.style.height).toBe("");
    restore = withHeights();
  });

  it("is not there for somebody who cannot see the surface", () => {
    // A placeholder is not content. Whoever has the list read out hears two
    // entries and not six, four of which say nothing.
    const { container } = list([52, 52], 4);
    expect(placeholder(container)).toHaveAttribute("aria-hidden", "true");
    expect(placeholder(container)?.textContent).toBe("");
    expect(screen.getAllByRole("button", { name: /^Row/ })).toHaveLength(2);
  });

  it("counts only its own list's rows in a shared container", () => {
    const { container } = render(
      <div className="tree">
        <button type="button" className="featrow" data-h={40}>
          Feature 1
        </button>
        <button type="button" className="scenrow" data-h={120}>
          Scenario
        </button>
        <button type="button" className="scenrow" data-h={120}>
          Scenario
        </button>
        <button type="button" className="featrow" data-h={40}>
          Feature 2
        </button>
        <Pager name="cat:a/b" page={paged([1, 2], 4)} onGoto={() => {}} rowSelector=".featrow" />
      </div>,
    );
    expect(placeholder(container)?.style.height).toBe("160px");
  });
});

it("reports the total and page with a terse alternative", () => {
  const page = { slice: [1, 2], page: 1, pages: 3, total: 7, fill: 0 };
  const view = render(<Pager name="count" page={page} onGoto={() => {}} />);
  expect(screen.getByTestId("pager-info")).toHaveTextContent(/^7 entries · page 2 of 3$/);
  view.rerender(<Pager name="count" page={page} onGoto={() => {}} terse />);
  expect(screen.getByTestId("pager-info")).toHaveTextContent(/^2\/3$/);
});
it("refreshes placeholder height when observed rows resize", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const restore = withHeights();
  const observe = jest.fn(),
    disconnect = jest.fn();
  let remeasure: () => void = () => {
    throw new Error("ResizeObserver was not created");
  };
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: jest.fn((callback: () => void) => {
      remeasure = callback;
      return { observe, disconnect };
    }),
  });
  try {
    const view = list([40, 40], 3);
    expect(placeholder(view.container)?.style.height).toBe("120px");
    const rows = screen.getAllByRole("button", { name: /^Row/ });
    expect(observe).toHaveBeenCalledTimes(2);
    expect(observe.mock.calls.map(([node]) => node)).toEqual(expect.arrayContaining(rows));
    rows[0].dataset.h = "80";
    rows[1].dataset.h = "120";
    act(() => remeasure());
    expect(placeholder(view.container)?.style.height).toBe("300px");
    view.unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally {
    restore();
    if (descriptor) Object.defineProperty(globalThis, "ResizeObserver", descriptor);
    else Reflect.deleteProperty(globalThis, "ResizeObserver");
  }
});
