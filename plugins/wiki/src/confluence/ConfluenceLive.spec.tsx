import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfluenceLive from "./ConfluenceLive";
import { inEnglish } from "../../../shared/language.spec-support";

inEnglish();
it.each(["loading", "error"])("closes the %s host view", async (state) => {
  const onDismiss = jest.fn();
  const fetchState = (
    state === "loading"
      ? () => new Promise(() => {})
      : () => Promise.reject(new Error("offline"))
  ) as typeof fetch;
  render(<ConfluenceLive onDismiss={onDismiss} fetchState={fetchState} />);
  if (state === "error") await screen.findByText("offline");
  await userEvent.click(screen.getByRole("button", { name: /close/i }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});
