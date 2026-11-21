import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { coreRoleKey } from "./generative";

const model = taskflowModel();

function mount(path: string) {
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={null} />);
}

const nav = () => screen.getByRole("navigation", { name: "Areas" });

/** The role button names the current role; the default is the developer's. */
async function chooseRole(name: RegExp) {
  await userEvent.click(screen.getByRole("button", { name: "Developer" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
});

describe("generative section on the Overview", () => {
  it("appears on the Leadership Overview once the switch is on in the settings", async () => {
    mount("/settings/genui");
    await userEvent.click(
      within(screen.getByTestId("genui-roles")).getByRole("switch", { name: "Leadership" }),
    );
    await userEvent.click(within(nav()).getByRole("button", { name: "Overview" }));
    await chooseRole(/Leadership/);
    const overview = screen.getByTestId("overview");
    expect(overview).toHaveAttribute("data-role", "leadership");
    const section = within(overview).getByTestId("gen-section-leadership");
    // The measured tiles stand without a model: real figures from the records.
    expect(within(section).getAllByText(/./).length).toBeGreaterThan(3);
    expect(within(overview).getByTestId("overview-kpis").compareDocumentPosition(section)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("reads the switch under the stored role key for the roles the reader names differently", async () => {
    window.localStorage.setItem("facet.atlas.state", JSON.stringify({ generativeOn: ["dev"] }));
    mount("/");
    expect(screen.getByTestId("overview")).toHaveAttribute("data-role", "dev");
    expect(screen.getByTestId("gen-section-dev")).toBeInTheDocument();
    await chooseRole(/Leadership/);
    expect(screen.queryByTestId("overview-generative")).not.toBeInTheDocument();
  });

  it("stays away while the switch is off", () => {
    mount("/");
    expect(screen.getByTestId("overview")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-generative")).not.toBeInTheDocument();
  });

  it("maps every role onto a stored role key", () => {
    expect(
      ["leadership", "dev", "review", "author", "owner", "newcomer", "agent"].map(coreRoleKey),
    ).toEqual(["leadership", "dev", "review", "author", "owner", "newcomer", "agent"]);
  });
});
