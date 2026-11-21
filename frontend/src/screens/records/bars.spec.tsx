import { fireEvent, screen } from "@testing-library/react";
import { renderInEnglish as render } from "../testing";
import { RecordDetailsPage } from "./RecordDetailsPage";
import { recordOf, siblingsOf } from "./storyData.spec-support";

/** jsdom lays nothing out: every box is 0 high and no ResizeObserver exists.
 * These cases give the measured boxes a height and hold the observers, so
 * that what the page writes can be read where it lands, on the elements the
 * CSS reads it from. */

let heights: Map<string, number>;
let observers: { cb: ResizeObserverCallback; el?: Element }[];
const realRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  heights = new Map();
  observers = [];
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const height = heights.get(this.getAttribute("data-testid") ?? "") ?? 0;
    return { top: 0, bottom: height, left: 0, right: 0, width: 0, height } as DOMRect;
  };
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    entry: { cb: ResizeObserverCallback; el?: Element };
    constructor(cb: ResizeObserverCallback) {
      this.entry = { cb };
      observers.push(this.entry);
    }
    observe(el: Element) {
      this.entry.el = el;
    }
    disconnect() {
      observers.splice(observers.indexOf(this.entry), 1);
    }
  };
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect;
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe("the bars' height on a record page", () => {
  it("is measured before a section jump, with the pinned strip drawn full", () => {
    const record = recordOf("workspace/board/column");
    // The pinned rows still stand below the strip's line: nothing has
    // scrolled away, so the page opens without the strip.
    for (const key of ["head-name", "head-id"]) heights.set(key, 400);
    heights.set("record-stuck", 96);
    const seen: { strip: boolean; cover: string }[] = [];
    Element.prototype.scrollIntoView = function () {
      seen.push({
        strip: screen.queryByTestId("record-stuck") != null,
        cover: screen.getByTestId("record").style.getPropertyValue("--t-b-stuck-h"),
      });
    };
    render(
      <RecordDetailsPage
        state="ready"
        record={record}
        siblings={siblingsOf(record.id)}
        tab="record"
        now="2026-11"
        stuck={["name", "id"]}
        onStick={() => {}}
      />,
    );
    expect(screen.queryByTestId("record-stuck")).toBeNull();
    expect(screen.getByTestId("record").style.getPropertyValue("--t-b-stuck-h")).toBe("0px");
    fireEvent.click(screen.getByRole("link", { name: /^History/ }));
    // At the moment of the scroll the strip that will show at the section is
    // already drawn and its height is what the section keeps clear of.
    expect(seen).toEqual([{ strip: true, cover: "96px" }]);
  });
});
