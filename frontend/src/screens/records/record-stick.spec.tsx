import { fireEvent, screen, within } from "@testing-library/react";
import { renderInEnglish as render } from "../testing";
import { RecordDetailsPage, type RecordDetailsPageProps } from "./RecordDetailsPage";
import { recordOf, siblingsOf } from "./storyData.spec-support";

const record = recordOf("workspace/board/column");

function props(over: Partial<RecordDetailsPageProps> = {}): RecordDetailsPageProps {
  return {
    state: "ready",
    record,
    siblings: siblingsOf(record.id),
    tab: "record",
    now: "2026-11",
    ...over,
  };
}

describe("pinnable record head", () => {
  it("draws no pin and no strip without a handler", () => {
    render(<RecordDetailsPage {...props()} />);
    expect(screen.queryByRole("button", { name: /pin to top$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pinned to the top" })).not.toBeInTheDocument();
  });

  it("names each row's pin and reports the row it pins", () => {
    const onStick = jest.fn();
    render(<RecordDetailsPage {...props({ onStick })} />);
    for (const [what, key] of [
      ["path", "path"],
      ["status", "status"],
      ["name", "name"],
      ["id", "id"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: `Pin ${what} to the top` }));
      expect(onStick).toHaveBeenLastCalledWith(key, true);
    }
    // A tap on a row focuses it, so a phone shows its pin as a hover would.
    expect(screen.getByTestId("head-name")).toHaveAttribute("tabindex", "-1");
  });

  it("copies pinned rows into the strip, in head order, with a way to unpin", () => {
    const onStick = jest.fn();
    render(<RecordDetailsPage {...props({ stuck: ["id", "path", "status"], onStick })} />);
    const strip = screen.getByRole("region", { name: "Pinned to the top" });
    const rows = within(strip).getAllByTestId(/^stuck-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual(["stuck-path", "stuck-status", "stuck-id"]);
    // The strip's path is a way back up, not a second sibling menu.
    expect(within(strip).queryByRole("button", { name: "Show siblings" })).toBeNull();
    expect(within(strip).getByText(record.id)).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole("button", { name: "Unpin id" }));
    expect(onStick).toHaveBeenLastCalledWith("id", false);
  });
});
