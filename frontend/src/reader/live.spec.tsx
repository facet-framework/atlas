/** A failed corpus read stays on the boot screen and can be retried. */

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FACETRC, INDEX, RECORDS, SCAN } from "@/model/fixtures";
import AtlasLive from "./AtlasLive";

// The real corpus the fixtures carry; AtlasLive builds its real model from it.
const source = { facetrc: FACETRC, index: INDEX, records: RECORDS, scan: SCAN };

/** A transport the test answers by hand: each `open` is a fresh one, counted. */
function streamSource() {
  let count = 0;
  let send: ((value: unknown) => void) | undefined;
  let sendError: ((message: string) => void) | undefined;
  const open = () => {
    count++;
    const listeners = new Map<string, (event: MessageEvent) => void>();
    send = (value) => listeners.get("ready")?.({ data: JSON.stringify(value) } as MessageEvent);
    sendError = (message) =>
      listeners.get("failed")?.({ data: JSON.stringify({ message }) } as MessageEvent);
    return {
      addEventListener: (name: string, listener: (event: MessageEvent) => void) => {
        listeners.set(name, listener);
      },
      removeEventListener: (name: string) => {
        listeners.delete(name);
      },
      close: () => listeners.clear(),
    };
  };
  global.EventSource = function () {
    return open();
  } as unknown as typeof EventSource;
  return {
    ready: (value: unknown) => send?.(value),
    fail: (message: string) => sendError?.(message),
    opens: () => count,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  window.scrollTo = jest.fn();
});

describe("the Atlas boot screen", () => {
  it("retries a failed corpus read on a fresh transport and replaces the error with the reader", async () => {
    const transport = streamSource();
    const user = userEvent.setup();
    render(<AtlasLive />);
    expect(transport.opens()).toBe(1);
    await act(async () => transport.fail("fixture transport failure"));
    expect(await screen.findByText("fixture transport failure")).toBeVisible();
    expect(screen.queryByRole("navigation", { name: /Areas|Areas/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(transport.opens()).toBe(2);
    expect(screen.queryByText("fixture transport failure")).not.toBeInTheDocument();
    await act(async () => transport.ready(source));
    expect(await screen.findByRole("navigation", { name: /Areas|Areas/ })).toBeInTheDocument();
  });
});
