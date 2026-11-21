/** The settings page "Generative UI" against the Overview it switches: one
 * switch per core role, all off at first, each turning only its own role's
 * section on and off, and the choice surviving a restart. */

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import { ROLE_LIST } from "@/roles";
import Atlas from "./Atlas";
import { coreRoleKey } from "./generative";
import { ROLE_STORAGE_KEY } from "./reader-role";

const model = taskflowModel();
const READER_ROLES = ["leadership", "dev", "review", "author", "owner", "newcomer", "agent"];

function mount(path: string, role?: string) {
  cleanup();
  if (role) window.localStorage.setItem(ROLE_STORAGE_KEY, role);
  window.history.replaceState(null, "", path);
  return render(<Atlas model={model} readers={null} />);
}

/** Whether the Overview drawn under `role` carries its generative section. */
function sectionOn(role: string): boolean {
  mount("/", role);
  expect(screen.getByTestId("overview")).toHaveAttribute("data-role", role);
  return screen.queryByTestId("overview-generative") !== null;
}

async function flip(label: string) {
  mount("/settings/genui");
  await userEvent.click(
    within(screen.getByTestId("genui-roles")).getByRole("switch", { name: label }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // Each mount opens the address it names, not the place the last one left.
  window.localStorage.setItem("facet.atlas.preferences", JSON.stringify({ restoreLast: false }));
  window.scrollTo = jest.fn();
});

describe("one generative switch per core role", () => {
  it("lists one switch per core role, every one off", () => {
    mount("/settings/genui");
    const switches = within(screen.getByTestId("genui-roles")).getAllByRole("switch");
    expect(switches).toHaveLength(ROLE_LIST.length);
    for (const s of switches) expect(s).toHaveAttribute("aria-checked", "false");
    // Every core role of the Overview has its switch.
    expect(READER_ROLES.map(coreRoleKey).sort()).toEqual(ROLE_LIST.map((r) => r.key).sort());
  });

  it("turns only its own role's section on and off, and keeps the choice across a restart", async () => {
    const [lead, dev] = [ROLE_LIST[0], ROLE_LIST[1]];
    expect(coreRoleKey("leadership")).toBe(lead.key);
    expect(coreRoleKey("dev")).toBe(dev.key);
    expect(sectionOn("leadership")).toBe(false);

    await flip(lead.label);
    expect(sectionOn("leadership")).toBe(true);
    expect(sectionOn("dev")).toBe(false);

    await flip(dev.label);
    expect(sectionOn("dev")).toBe(true);
    expect(sectionOn("leadership")).toBe(true);
    // A third role left off stays off.
    expect(sectionOn("agent")).toBe(false);

    await flip(lead.label);
    expect(sectionOn("leadership")).toBe(false);
    expect(sectionOn("dev")).toBe(true);
  });
});
