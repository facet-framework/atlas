import { createText as createGermanText } from "../component-text/text";
import { render, screen } from "@testing-library/react";
import { CoverageRing } from "./chart-elements";
import { renderInGerman } from "../component-text/testing";

const germanText = createGermanText("de");

const base = { value: 19, total: 38 };

describe("Unit tests for CoverageRing", () => {
  it("names the share in plain words", () => {
    render(<CoverageRing {...base} />);
    expect(
      screen.getByRole("meter", { name: "19 of 38 promises with a mapped test" }),
    ).toBeInTheDocument();
  });

  it("shows the percentage in the middle", () => {
    render(<CoverageRing {...base} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("draws track and arc", () => {
    const { container } = render(<CoverageRing {...base} />);
    expect(container.querySelectorAll("circle")).toHaveLength(2);
  });

  it("sets the arc as a dash pattern", () => {
    const { container } = render(<CoverageRing {...base} />);
    expect(container.querySelectorAll("circle")[1]).toHaveAttribute(
      "stroke-dasharray",
      "138.23 138.23",
    );
  });
});

describe("Coverage ring element adapter", () => {
  it("computes the share in percent", () => {
    render(<CoverageRing value={31} total={38} />);
    expect(screen.getByText("82%")).toBeInTheDocument();
  });

  it("phrases the plain words from value and reference total", () => {
    render(<CoverageRing value={31} total={38} />);
    expect(
      screen.getByRole("meter", { name: "31 of 38 promises with a mapped test" }),
    ).toBeInTheDocument();
  });

  it("colours full coverage green", () => {
    const { container } = render(<CoverageRing value={38} total={38} />);
    expect(container.querySelectorAll("circle")[1]).toHaveStyle({ stroke: "var(--t-ok)" });
  });

  it("says nothing when the reference total is missing", () => {
    render(<CoverageRing value={0} total={0} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("phrases the plain words in German under the German locale", () => {
    renderInGerman(<CoverageRing value={31} total={38} />);
    expect(
      screen.getByRole("meter", {
        name: germanText.t("elements.coverageRing.label", { value: "31", total: "38" }),
      }),
    ).toBeInTheDocument();
  });

  it("accepts an own size", () => {
    const { container } = render(<CoverageRing value={1} total={2} size={56} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "56");
  });

  it("accepts its own plain words", () => {
    render(<CoverageRing value={1} total={2} label="Half backed" />);
    expect(screen.getByRole("meter", { name: "Half backed" })).toBeInTheDocument();
  });
});

describe("Snapshot tests for CoverageRing", () => {
  it("partly covered", () => {
    const { container } = render(<CoverageRing value={31} total={38} />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("without promises", () => {
    const { container } = render(<CoverageRing value={0} total={0} />);
    expect(container.firstChild).toMatchSnapshot();
  });
});
