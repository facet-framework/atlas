import { useState } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderInEnglish as render } from "../testing";
import { DOMAINS, FEATURES } from "./data.spec-support";
import { ProductPage } from "./ProductPage";

const source = FEATURES.find(
  (feature) =>
    feature.scenarios > 0 &&
    DOMAINS.some(
      (domain) =>
        domain.id === feature.domain &&
        domain.capabilities.some((capability) => capability.id === feature.capability),
    ),
)!;
const features = Array.from({ length: 10 }, (_, i) => ({
  ...source,
  id: source.id + "-" + (i + 1),
  slug: "record-" + (i + 1),
  fixCount: (i + 1) * 100,
  deviationCount: 10 - i,
  fixCommits: Array.from({ length: (i + 1) * 100 }, (_, j) => ({
    commit: `${i}-${j}`,
    date: "2026-01-01",
  })),
}));

it("offers storey lenses on both maps and updates the legend and cell colours", async () => {
  const props = { domains: DOMAINS, features, onStoreyLens: jest.fn() };
  const { rerender } = render(<ProductPage {...props} view="city" />);
  const control = () => within(screen.getByTestId("storey-lens"));
  expect(control().getByRole("radio", { name: "Test coverage" })).toBeChecked();
  await userEvent.click(control().getByRole("radio", { name: "Bug fixes" }));
  expect(props.onStoreyLens).toHaveBeenCalledWith("fixes");

  rerender(<ProductPage {...props} view="city" storeyLens="fixes" />);
  expect(screen.getByTestId("storey-legend")).toHaveTextContent("01–23–78–1920+");
  expect(screen.getByTestId("tower-" + features[0].id).style.getPropertyValue("--t-a-fill")).toBe(
    "var(--t-storey-fixes-peak)",
  );

  rerender(<ProductPage {...props} view="treemap" storeyLens="deviations" />);
  expect(control().getByRole("radio", { name: "Deviations" })).toBeChecked();
  expect(screen.getByTestId("storey-legend")).toHaveTextContent("NoneWith deviations");
  const cell = within(screen.getByTestId("treemap")).getByRole("button", {
    name: features[0].id + ": 10 deviations",
  });
  expect(cell).toHaveStyle({ fill: "var(--t-storey-deviations-present)" });

  rerender(<ProductPage {...props} view="list" storeyLens="deviations" />);
  expect(screen.queryByTestId("storey-lens")).not.toBeInTheDocument();
  expect(screen.queryByTestId("storey-ranking")).not.toBeInTheDocument();
});

it("ranks eight affected records and lets readers select a record", async () => {
  const onSelect = jest.fn();
  const props = {
    domains: DOMAINS,
    features,
    view: "treemap" as const,
    storeyLens: "fixes" as const,
    onSelect,
    storeyContentsHref: () => "/contents/fixed",
  };
  const { rerender } = render(<ProductPage {...props} />);
  const ranking = within(screen.getByTestId("storey-ranking"));
  expect(ranking.getByRole("heading", { name: "Most bug fixes" })).toBeInTheDocument();
  expect(ranking.getByTestId("storey-total")).toHaveTextContent("5,500 fixes");
  expect(ranking.getByRole("link", { name: "All 10 records" })).toHaveAttribute(
    "href",
    "/contents/fixed",
  );
  const rows = ranking.getAllByRole("button");
  expect(rows.map((row) => row.textContent)).toEqual(
    features
      .slice(2)
      .reverse()
      .map((f) => f.id + f.fixCount.toLocaleString("en")),
  );
  await userEvent.click(rows[0]);
  expect(onSelect).toHaveBeenCalledWith(features[9].id);

  rerender(<ProductPage {...props} selected={features[9].id} />);
  expect(screen.queryByTestId("storey-ranking")).not.toBeInTheDocument();
  expect(screen.getByTestId("selected-fix-count")).toHaveTextContent(/^1,000$/);
  expect(screen.getByTestId("selected-deviation-count")).toHaveTextContent(/^1$/);

  rerender(<ProductPage {...props} mobile />);
  expect(screen.getByTestId("storey-lens")).toBeInTheDocument();
  expect(screen.queryByTestId("storey-ranking")).not.toBeInTheDocument();
});

it("shows unmeasured fixes in the legend, ranking and selection", () => {
  const feature = { ...source, fixCount: null, deviationCount: 0 };
  const props = {
    domains: DOMAINS,
    features: [feature],
    storeyContentsHref: () => "/contents/fixed",
    view: "treemap" as const,
    storeyLens: "fixes" as const,
  };
  const { rerender } = render(<ProductPage {...props} />);
  expect(screen.getByTestId("storey-legend")).toHaveTextContent("Not measured");
  expect(screen.getByTestId("storey-total")).toHaveTextContent(/^Not measured$/);
  expect(within(screen.getByTestId("storey-ranking")).queryByRole("link")).not.toBeInTheDocument();
  expect(
    within(screen.getByTestId("treemap")).getByRole("button", {
      name: feature.id + ": Not measured",
    }),
  ).toHaveStyle({ fill: "var(--t-storey-unmeasured)" });

  rerender(<ProductPage {...props} selected={feature.id} />);
  expect(screen.getByTestId("selected-fix-count")).toHaveTextContent(/^Not measured$/);
  expect(screen.getByTestId("selected-deviation-count")).toHaveTextContent(/^0$/);
});

it("counts dated fixes through the chosen day and retains undated deviations", () => {
  const feature = {
    ...source,
    createdAt: "2026-01-01",
    fixCommits: ["2026-04-01", "2026-03-01", "2026-01-01"].map((date) => ({ commit: date, date })),
    fixCount: 3,
    deviationCount: 2,
  };
  const dates = ["2026-01-01", "2026-03-01", "2026-04-01"];
  const props = {
    domains: DOMAINS,
    features: [feature],
    view: "treemap" as const,
    selected: feature.id,
  };
  const { rerender } = render(<ProductPage {...props} time={{ dates, index: 1 }} />);
  expect(screen.getByTestId("selected-fix-count")).toHaveTextContent(/^2$/);
  expect(screen.getByTestId("selected-deviation-count")).toHaveTextContent(/^2$/);
  rerender(<ProductPage {...props} time={{ dates, index: 2 }} />);
  expect(screen.getByTestId("selected-fix-count")).toHaveTextContent(/^3$/);
});

it("counts a shared fix once in the ranking and shows both record ids and row counts", () => {
  const otherDomain = DOMAINS.find(
    (domain) => domain.id !== source.domain && domain.capabilities.length,
  )!;
  const secondCapability = otherDomain.capabilities[0].id;
  const fixCommits = [{ commit: "shared", date: "2026-01-01" }];
  const first = { ...source, fixCommits, fixCount: 1 };
  const second = {
    ...first,
    id: `${otherDomain.id}/${secondCapability}/${first.slug}`,
    domain: otherDomain.id,
    capability: secondCapability,
  };
  render(
    <ProductPage domains={DOMAINS} features={[first, second]} view="treemap" storeyLens="fixes" />,
  );
  const ranking = within(screen.getByTestId("storey-ranking"));
  expect(ranking.getByTestId("storey-total")).toHaveTextContent(/^1 fix$/);
  for (const feature of [first, second]) {
    expect(ranking.getByRole("button", { name: feature.id + " 1" })).toBeInTheDocument();
  }
});

it.each([
  ["no records", []],
  ["zero fixes on a measured record", [{ ...source, fixCount: 0, fixCommits: [] }]],
])("shows None and no Contents link with %s", (_label, features) => {
  render(
    <ProductPage
      domains={DOMAINS}
      features={features}
      view="treemap"
      storeyLens="fixes"
      storeyContentsHref={() => "/contents/fixed"}
    />,
  );
  const ranking = within(screen.getByTestId("storey-ranking"));
  expect(ranking.getByTestId("storey-total")).toHaveTextContent(/^None$/);
  expect(ranking.queryByRole("button")).not.toBeInTheDocument();
  expect(ranking.queryByRole("link")).not.toBeInTheDocument();
});

it("updates the ranking total, row order and treemap band when the time slider moves", () => {
  const past = "2026-03-01";
  const later = "2026-04-01";
  const dates = ["2026-01-01", past, later];
  const first = {
    ...features[0],
    createdAt: dates[0],
    fixCount: 3,
    fixCommits: [past, later, later].map((date, i) => ({ date, commit: "first-" + i })),
  };
  const second = {
    ...features[1],
    createdAt: dates[0],
    fixCount: 3,
    fixCommits: [dates[0], past, ""].map((date, i) => ({ date, commit: "second-" + i })),
  };
  function TimedProduct() {
    const [index, setIndex] = useState(2);
    return (
      <ProductPage
        domains={DOMAINS}
        features={[first, second]}
        view="treemap"
        storeyLens="fixes"
        time={{ dates, index }}
        onTime={setIndex}
      />
    );
  }
  render(<TimedProduct />);
  const ranking = within(screen.getByTestId("storey-ranking"));
  const cell = (label: string) =>
    within(screen.getByTestId("treemap")).getByRole("button", { name: first.id + ": " + label });
  // The undated fix counts at the last stop and drops out at an earlier one.
  expect(ranking.getByTestId("storey-total")).toHaveTextContent(/^6 fixes$/);
  expect(ranking.getAllByRole("button").map((row) => row.textContent)).toEqual([
    first.id + "3",
    second.id + "3",
  ]);
  expect(cell("3 fixes")).toHaveStyle({ fill: "var(--t-storey-fixes-medium)" });
  fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", past);
  expect(ranking.getByTestId("storey-total")).toHaveTextContent(/^3 fixes$/);
  expect(ranking.getAllByRole("button").map((row) => row.textContent)).toEqual([
    second.id + "2",
    first.id + "1",
  ]);
  expect(cell("1 fix")).toHaveStyle({ fill: "var(--t-storey-fixes-low)" });
});
