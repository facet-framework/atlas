import { fireEvent, screen, within } from "@testing-library/react";
import { renderInEnglish as render } from "../testing";
import { createText } from "../text";
import { OverviewPage } from "./OverviewPage";
import { CapabilityPage } from "./CapabilityPage";
import { ProductPage } from "./ProductPage";
import { CommitList, OpenRecordList } from "./parts";
import { capabilityData, DOMAINS, overviewModel } from "./data.spec-support";
import { FixedPage, TestsPage } from "../contents/Evidence";
import { TaxonomyPage } from "../contents/Structure";
import { PromisesPage } from "../contents/Promises";
import * as data from "../contents/data.spec-support";

const t = createText("en").t;

function section(key: string) {
  const element = screen.getByRole("heading", { name: t(key) }).closest("section");
  if (!element) throw new Error(`Missing section: ${key}`);
  return within(element);
}

function modelWithoutMosaics() {
  const model = overviewModel();
  const feature = {
    ...model.features.find((f) => f.type === "feature" && DOMAINS.some((d) => d.id === f.domain))!,
    scenarios: 3,
    proven: 1,
    tests: 0,
    knowledgeOpen: 2,
    mosaic: undefined,
    createdAt: model.project.generatedAt,
  };
  return { ...model, features: [feature] };
}

it("opens the leadership map and a feature created during the reported week", () => {
  const model = modelWithoutMosaics();
  const onNavigate = jest.fn();
  const onOpenRecord = jest.fn();
  render(
    <OverviewPage
      reader="leadership"
      model={model}
      onNavigate={onNavigate}
      onOpenRecord={onOpenRecord}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: t("ui.screens-frame.overviewpage-map") }));
  expect(onNavigate).toHaveBeenLastCalledWith("product");
  const week = within(screen.getByTestId("overview-leadership-week"));
  fireEvent.click(week.getByRole("button"));
  expect(onOpenRecord).toHaveBeenLastCalledWith(model.features[0].id);
});

it("opens reviewer collections and their specific records", () => {
  const model = modelWithoutMosaics();
  const onNavigate = jest.fn();
  const onOpenRecord = jest.fn();
  render(
    <OverviewPage
      reader="review"
      model={model}
      onNavigate={onNavigate}
      onOpenRecord={onOpenRecord}
    />,
  );
  const all = t("ui.screens-frame.overviewpage-all");
  fireEvent.click(
    section("ui.screens-frame.overviewpage-declared-deviations").getByRole("button", { name: all }),
  );
  expect(onNavigate).toHaveBeenLastCalledWith("deviations");
  fireEvent.click(within(screen.getByTestId("overview-test-deviations")).getByRole("button"));
  expect(onOpenRecord).toHaveBeenLastCalledWith(model.deviations![0].record);
  fireEvent.click(
    section("ui.screens-frame.overviewpage-open-promises").getByRole("button", { name: all }),
  );
  expect(onNavigate).toHaveBeenLastCalledWith("promises");
  fireEvent.click(
    section("ui.screens-frame.overviewpage-active-records-without-test").getByRole("button"),
  );
  expect(onOpenRecord).toHaveBeenLastCalledWith(model.features[0].id);
  fireEvent.click(
    section("ui.screens-frame.overviewpage-active-records-open-knowledge").getByRole("button", {
      name: all,
    }),
  );
  expect(onNavigate).toHaveBeenLastCalledWith("knowledge");
  fireEvent.click(within(screen.getByTestId("overview-test-undocumented")).getByRole("button"));
  expect(onOpenRecord).toHaveBeenLastCalledWith(model.features[0].id);
});

it("opens an owner's dependency record", () => {
  const model = overviewModel();
  const onOpenRecord = jest.fn();
  render(<OverviewPage reader="owner" model={model} onOpenRecord={onOpenRecord} />);
  const reach = within(screen.getByTestId("overview-owner-reach"));
  fireEvent.click(reach.getAllByRole("button")[0]);
  expect(onOpenRecord).toHaveBeenLastCalledWith(model.reach![0].record);
});

it("keeps records actionable when only scenario counts are available", () => {
  const model = modelWithoutMosaics();
  const feature = model.features[0];
  const onOpenRecord = jest.fn();
  const { rerender } = render(
    <OpenRecordList features={[feature]} limit={6} onOpenRecord={onOpenRecord} />,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(onOpenRecord).toHaveBeenLastCalledWith(feature.id);
  rerender(
    <CommitList
      commits={[{ sha: "abc123", date: "2026-11-01", subject: "Fix task", record: feature.id }]}
      limit={6}
      onOpenRecord={onOpenRecord}
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  expect(onOpenRecord).toHaveBeenLastCalledWith(feature.id);
});

it("opens a capability record from its scenario mosaic and table with count-only evidence", () => {
  const domain = DOMAINS.find((d) => d.id === modelWithoutMosaics().features[0].domain)!;
  const feature = modelWithoutMosaics().features[0];
  const capability = domain.capabilities.find((c) => c.id === feature.capability)!;
  const onOpenRecord = jest.fn();
  const props = {
    ...capabilityData(domain.id, capability.id),
    domain,
    domains: DOMAINS,
    capability,
    features: [feature],
    onOpenRecord,
  };
  const { rerender } = render(<CapabilityPage {...props} view="field" />);
  fireEvent.click(
    within(
      screen.getByRole("group", { name: t("ui.screens-frame.capabilitypage-test-mosaic") }),
    ).getByRole("button"),
  );
  expect(onOpenRecord).toHaveBeenLastCalledWith(feature.id);
  rerender(<CapabilityPage {...props} view="table" />);
  fireEvent.click(
    within(
      screen.getByRole("grid", { name: t("ui.screens-frame.capabilitypage-records-capability") }),
    ).getAllByRole("row")[1],
  );
  expect(onOpenRecord).toHaveBeenLastCalledWith(feature.id);
});

it("closes a mobile product selection and zooms the city around a double click", () => {
  const feature = modelWithoutMosaics().features[0];
  const onSelect = jest.fn();
  const { rerender } = render(
    <ProductPage
      domains={DOMAINS}
      features={[feature]}
      view="city"
      mobile
      selected={feature.id}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
  expect(onSelect).toHaveBeenLastCalledWith(null);
  rerender(<ProductPage domains={DOMAINS} features={[feature]} view="city" onSelect={onSelect} />);
  const city = screen.getByTestId("city");
  const zoom = Number(city.getAttribute("data-zoom"));
  fireEvent.doubleClick(city, { clientX: 100, clientY: 100 });
  expect(Number(city.getAttribute("data-zoom"))).toBeGreaterThan(zoom);
});

it("opens a test file from its table row", () => {
  const file = data.testFiles[0];
  const onOpenFile = jest.fn();
  render(
    <TestsPage
      view="table"
      kinds={data.testKinds}
      runners={data.testRunners}
      files={[file]}
      page={1}
      pageSize={25}
      total={1}
      onOpenFile={onOpenFile}
    />,
  );
  fireEvent.click(within(screen.getByTestId("tests-table")).getAllByRole("row")[1]);
  expect(onOpenFile).toHaveBeenLastCalledWith(file.path);
});

it("copies the complete hash from a fix's detail card", () => {
  const commit = data.fixes[0];
  const onCopy = jest.fn();
  render(<FixedPage view="timeline" commits={[commit]} onCopy={onCopy} />);
  fireEvent.click(screen.getByText(commit.subject).closest("button")!);
  fireEvent.click(
    within(screen.getByTestId("fix-detail")).getByRole("button", {
      name: t("ui.screens-contents.evidence-copy-full-hash"),
    }),
  );
  expect(onCopy).toHaveBeenLastCalledWith(commit.sha);
});

it("selects a taxonomy domain from the sunburst legend", () => {
  const onSelect = jest.fn();
  render(<TaxonomyPage view="sun" domains={data.taxonomy} expanded={[]} onSelect={onSelect} />);
  const legend = within(
    screen.getByRole("list", { name: t("ui.screens-contents.structure-areas") }),
  );
  fireEvent.click(legend.getAllByRole("button")[0]);
  expect(onSelect).toHaveBeenLastCalledWith(data.taxonomy[0].id);
});

it("selects a specific open promise from the prioritized list", () => {
  const item = data.promiseItems.find((p) => p.state !== "proven")!;
  const onSelect = jest.fn();
  render(
    <PromisesPage
      view="open"
      totals={data.promiseTotals}
      items={[item]}
      records={data.promiseRecords}
      page={1}
      pageSize={25}
      total={1}
      query=""
      facets={[]}
      onSelect={onSelect}
    />,
  );
  fireEvent.click(screen.getByText(item.scenarioId).closest("button")!);
  expect(onSelect).toHaveBeenLastCalledWith(item.key);
});
