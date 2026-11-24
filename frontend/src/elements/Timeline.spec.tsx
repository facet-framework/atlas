import { createText } from "@facet-tools/ui";
const monthName = (month: number) =>
  new Intl.DateTimeFormat("de", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
import { render, screen } from "@testing-library/react";
import { Timeline } from "./chart-elements";
import { renderInGerman } from "../component-text/testing";

const germanText = createText("de");

/** Creates `count` events in the given month. */
function at(month: string, count: number) {
  return Array.from({ length: count }, () => ({ date: `${month}-15` }));
}

function columns(container: HTMLElement) {
  return Array.from(container.querySelectorAll("[data-bucket]"));
}

describe("Unit tests for Timeline", () => {
  it("says so when nothing is dated", () => {
    render(<Timeline events={[]} />);
    expect(screen.getByText("No dated events")).toBeInTheDocument();
  });
});

describe("Timeline element adapter", () => {
  it("also draws the months without an event", () => {
    const { container } = render(<Timeline events={[...at("2026-01", 2), ...at("2026-04", 1)]} />);
    expect(columns(container).map((column) => column.getAttribute("data-bucket"))).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });

  it("leaves an empty month standing without a block", () => {
    const { container } = render(
      <Timeline events={[...at("2026-01", 2), ...at("2026-02", 0), ...at("2026-03", 1)]} />,
    );
    const block = columns(container)[1].querySelector("[aria-hidden=true]");
    expect(block).toHaveStyle({ height: "0px" });
  });

  it("names every section with name and number", () => {
    const { container } = render(<Timeline events={at("2026-03", 4)} unit="Records" />);
    expect(columns(container)[0]).toHaveAttribute("title", "March 2026 · 4 Records");
  });

  it("says for an empty month that nothing was created", () => {
    const { container } = render(<Timeline events={[...at("2026-01", 1), ...at("2026-03", 1)]} />);
    expect(columns(container)[1]).toHaveAttribute("title", "February 2026 · none");
  });

  it("gives the largest month the full height", () => {
    const { container } = render(
      <Timeline events={[...at("2026-01", 4), ...at("2026-02", 2)]} height={100} />,
    );
    const blocks = columns(container).map((column) => column.querySelector("[aria-hidden=true]"));
    expect(blocks[0]).toHaveStyle({ height: "100px" });
    expect(blocks[1]).toHaveStyle({ height: "50px" });
  });

  it("keeps a single entry visible instead of rounding it to zero", () => {
    const { container } = render(
      <Timeline events={[...at("2026-01", 200), ...at("2026-02", 1)]} height={96} />,
    );
    const block = columns(container)[1].querySelector("[aria-hidden=true]");
    expect(block).toHaveStyle({ height: "2px" });
  });

  it("labels the turn of the year", () => {
    const { container } = render(<Timeline events={[...at("2025-11", 1), ...at("2026-02", 1)]} />);
    // November, December, January, February — the label sits on January.
    // The first section stays unlabelled: two columns further on the next
    // number already stands, and two numbers on two columns overlap.
    expect(
      Array.from(container.querySelectorAll("[data-tick]")).map((tick) => tick.textContent),
    ).toEqual(["", "", "2026", ""]);
  });

  it("labels the start as soon as there is room up to the turn of the year", () => {
    const { container } = render(<Timeline events={[...at("2025-08", 1), ...at("2026-01", 1)]} />);
    expect(
      Array.from(container.querySelectorAll("[data-tick]")).map((tick) => tick.textContent),
    ).toEqual(["2025", "", "", "", "", "2026"]);
  });

  it("switches to years on its own beyond five years", () => {
    const { container } = render(<Timeline events={[...at("2020-01", 3), ...at("2026-01", 5)]} />);
    expect(columns(container).map((column) => column.getAttribute("data-bucket"))).toEqual([
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
      "2025",
      "2026",
    ]);
  });

  it("names the span and the densest section", () => {
    const { container } = render(
      <Timeline events={[...at("2026-01", 2), ...at("2026-03", 5)]} unit="Records" />,
    );
    expect(container).toHaveTextContent(
      "7 Records · January 2026 to March 2026 · most in March 2026 (5)",
    );
  });

  it("does not hide what has no date", () => {
    const { container } = render(
      <Timeline events={[...at("2026-01", 2), { date: "" }, { date: "sometime" }]} />,
    );
    expect(container).toHaveTextContent("2 without a date");
  });

  it("names the span, the unit and the months in German under the German locale", () => {
    const { container } = renderInGerman(
      <Timeline events={[...at("2026-01", 2), ...at("2026-03", 5)]} />,
    );
    expect(container).toHaveTextContent(
      `7 ${germanText.t("primitives.histogram.unit")} · ${germanText.t("primitives.histogram.range", { first: `${monthName(1)} 2026`, last: `${monthName(3)} 2026` })} · ${germanText.t("primitives.histogram.peak", { name: `${monthName(3)} 2026`, count: 5 })}`,
    );
    expect(columns(container)[1]).toHaveAttribute(
      "title",
      `${monthName(2)} 2026 · ${germanText.t("primitives.histogram.nothing")}`,
    );
  });

  it("falls back to the English unit and month names", () => {
    const { container } = render(<Timeline events={[...at("2026-01", 2), ...at("2026-03", 5)]} />);
    expect(container).toHaveTextContent(
      "7 events · January 2026 to March 2026 · most in March 2026 (5)",
    );
  });

  it("shows the quiet sentence when no event carries a date", () => {
    render(<Timeline events={[{ date: "" }]} empty="No creation date." />);
    expect(screen.getByText("No creation date.")).toBeInTheDocument();
  });
});
