/** The pointer walks the command list the way the arrow keys do: the row under
 * it becomes the one Enter takes. Read from the rendered list and the field. */

import { useState } from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderInEnglish as render } from "../testing";
import { Composer } from "./Chat";
import * as data from "./storyData.spec-support";

function Harness({ onSlash }: { onSlash: (cmd: string) => void }) {
  const [active, setActive] = useState(0);
  return (
    <Composer
      value="/"
      mode="Ask"
      model="opus"
      context={[]}
      enterSends
      slash={{ items: data.SLASH.slice(0, 3), active }}
      onSlashActive={setActive}
      onSlash={onSlash}
    />
  );
}

describe("the command list under the pointer", () => {
  it("makes the hovered row the one Enter runs", async () => {
    const onSlash = jest.fn();
    render(<Harness onSlash={onSlash} />);
    const list = screen.getByRole("menu", { name: "Commands" });
    const rows = within(list).getAllByRole("menuitem");
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    await userEvent.hover(rows[2]);
    expect(rows[2]).toHaveAttribute("aria-current", "true");
    expect(rows[0]).not.toHaveAttribute("aria-current");
    await userEvent.type(screen.getByLabelText("Question to Atlas"), "{Enter}");
    expect(onSlash).toHaveBeenCalledTimes(1);
    expect(onSlash).toHaveBeenCalledWith(data.SLASH[2].cmd);
  });

  it("leaves the choice where it is when the pointer is over the list but not a row", async () => {
    const onSlash = jest.fn();
    render(<Harness onSlash={onSlash} />);
    const list = screen.getByRole("menu", { name: "Commands" });
    await userEvent.hover(within(list).getByText("Commands"));
    expect(within(list).getAllByRole("menuitem")[0]).toHaveAttribute("aria-current", "true");
  });
});
