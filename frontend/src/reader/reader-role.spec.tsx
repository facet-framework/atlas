/** The role menu of the real Atlas top bar: shut until opened, closed by a
 * click outside or its own button, a choice that rearranges the Overview, and
 * a remembered role that survives a reload or falls back when nobody offers it. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { DEFAULT_ROLE, offeredRole, ROLE_STORAGE_KEY, storedRole } from "./reader-role";

beforeEach(() => {
  window.localStorage.clear();
  window.scrollTo = jest.fn();
  window.history.replaceState(null, "", "/");
});

const draw = () => render(<Atlas model={taskflowModel()} readers={null} />);
const roleButton = (name: string) => screen.getByRole("button", { name });
const menu = () => screen.queryByRole("menu");

describe("the role menu in the top bar", () => {
  it("is shut until opened, offers every role with its purpose and marks the active one", async () => {
    draw();
    expect(menu()).not.toBeInTheDocument();
    expect(roleButton("Developer")).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(roleButton("Developer"));
    expect(roleButton("Developer")).toHaveAttribute("aria-expanded", "true");
    const items = within(menu()!).getAllByRole("menuitemradio");
    const names = [
      "Leadership",
      "Developer",
      "Test & review",
      "Record author",
      "Ownership",
      "New here",
      "Agent",
    ];
    expect(items.map((i) => i.querySelector("span > span")?.textContent)).toEqual(names);
    // Each role carries its purpose beside its name.
    for (const item of items)
      expect(item.querySelectorAll("span > span")[1]?.textContent?.length).toBeGreaterThan(10);
    const active = items.filter((i) => i.getAttribute("aria-checked") === "true");
    expect(active).toHaveLength(1);
    expect(active[0]).toHaveTextContent("Developer");
  });

  it("closes on a click outside, stays open on one inside, and its button toggles it", async () => {
    draw();
    await userEvent.click(roleButton("Developer"));
    await userEvent.click(menu()!);
    expect(menu()).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("overview"));
    expect(menu()).not.toBeInTheDocument();
    await userEvent.click(roleButton("Developer"));
    expect(menu()).toBeInTheDocument();
    await userEvent.click(roleButton("Developer"));
    expect(menu()).not.toBeInTheDocument();
  });

  it("rearranges the Overview on a choice, closes the menu and names the role in the bar", async () => {
    draw();
    expect(screen.getByTestId("overview")).toHaveAttribute("data-role", "dev");
    expect(screen.getByRole("region", { name: "Drift" })).toBeInTheDocument();
    await userEvent.click(roleButton("Developer"));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Leadership/ }));
    expect(menu()).not.toBeInTheDocument();
    expect(roleButton("Leadership")).toBeInTheDocument();
    expect(screen.getByTestId("overview")).toHaveAttribute("data-role", "leadership");
    // Different blocks, not the same ones reordered.
    expect(screen.queryByRole("region", { name: "Drift" })).not.toBeInTheDocument();
    expect(screen.getByTestId("overview-leadership-week")).toBeInTheDocument();
  });

  it("keeps the chosen role across a reload", async () => {
    const first = draw();
    await userEvent.click(roleButton("Developer"));
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Ownership/ }));
    expect(storedRole()).toBe("owner");
    first.unmount();
    draw();
    expect(screen.getByTestId("overview")).toHaveAttribute("data-role", "owner");
  });

  it("falls back to a real role when the remembered one is offered by nobody", () => {
    window.localStorage.setItem(ROLE_STORAGE_KEY, "chef");
    // Precondition: the stored key is really there and really unknown.
    expect(storedRole()).toBe("chef");
    expect(offeredRole("chef", [{ key: "leadership" }])).toBe(DEFAULT_ROLE);
    draw();
    expect(screen.getByTestId("overview")).toHaveAttribute("data-role", DEFAULT_ROLE);
    expect(roleButton("Developer")).toBeInTheDocument();
  });
});
