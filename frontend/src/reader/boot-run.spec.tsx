/** The run behind Atlas, driven through the real corpus transport the reader
 * opens: what the boot screen prints for each status the host streams, and the
 * catalogue's "read again" opening a fresh read without leaving the place. */

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FACETRC, INDEX, RECORDS, SCAN } from "@/model/fixtures";
import AtlasLive from "./AtlasLive";

// The real corpus the fixtures carry; AtlasLive builds its real model from it.
const source = { facetrc: FACETRC, index: INDEX, records: RECORDS, scan: SCAN };

/** A transport the test answers by hand: each `open` is a fresh one, counted. */
function streamSource() {
  let count = 0;
  let emit: ((name: string, value: unknown) => void) | undefined;
  const open = () => {
    count++;
    const listeners = new Map<string, (event: MessageEvent) => void>();
    emit = (name, value) => listeners.get(name)?.({ data: JSON.stringify(value) } as MessageEvent);
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
    status: (value: unknown) => act(async () => emit?.("status", value)),
    ready: (value: unknown) => act(async () => emit?.("ready", value)),
    opens: () => count,
  };
}

const count = (key: "records" | "files" | "anchors") =>
  document.querySelectorAll(".t-boot__counts b")[["records", "files", "anchors"].indexOf(key)];
const bar = () => screen.getByRole("progressbar", { name: "Progress" });

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  window.scrollTo = jest.fn();
});

describe("the boot screen's counts", () => {
  it("draws a dash for each count no phase has taken yet, in one notation for all three", () => {
    streamSource();
    render(<AtlasLive />);
    for (const key of ["records", "files", "anchors"] as const)
      expect(count(key)).toHaveTextContent(/^—$/);
    expect(screen.getByTestId("boot")).not.toHaveTextContent(/\b0\b/);
  });

  it("prints each count the run took, and a zero the search for anchors measured", async () => {
    const transport = streamSource();
    render(<AtlasLive />);
    // The host leaves a zero out of its report: no anchor found in 812 files.
    await transport.status({ phase: "index", done: 812, total: 1852, records: 220, files: 812 });
    expect(count("records")).toHaveTextContent(/^220$/);
    expect(count("files")).toHaveTextContent(/^812$/);
    expect(count("anchors")).toHaveTextContent(/^0$/);
  });
});

describe("the boot screen's bar", () => {
  it("carries no share and says so while the tree is counted, whatever total the host sends", async () => {
    const transport = streamSource();
    render(<AtlasLive />);
    await transport.status({ phase: "enumerate", done: 812, records: 220 });
    expect(bar()).not.toHaveAttribute("aria-valuenow");
    expect(bar()).toHaveAttribute("aria-valuetext", "share not known yet");
    expect(screen.getByText("no share yet")).toHaveTextContent("no share yet");
    // … and one that sends an estimate gets the same bar.
    await transport.status({ phase: "enumerate", done: 400, total: 800, records: 220 });
    expect(bar()).not.toHaveAttribute("aria-valuenow");
    expect(bar()).toHaveAttribute("aria-valuetext", "share not known yet");
    expect(screen.getByText("no share yet")).toBeInTheDocument();
  });

  it("stops saying there is no share once a phase has a denominator", async () => {
    const transport = streamSource();
    render(<AtlasLive />);
    await transport.status({ phase: "enumerate", done: 812, records: 220 });
    expect(screen.getByText("no share yet")).toBeInTheDocument();
    await transport.status({ phase: "index", done: 400, total: 800, records: 220, files: 400 });
    expect(bar()).toHaveAttribute("aria-valuenow");
    expect(Number(bar().getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    expect(screen.queryByText("no share yet")).toBeNull();
  });
});

describe("reading again from the catalogue", () => {
  it("opens a fresh read of the repository and keeps the reader where it stood", async () => {
    const transport = streamSource();
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/contents");
    render(<AtlasLive />);
    await transport.ready(source);
    const run = await screen.findByTestId("hub-run");
    expect(transport.opens()).toBe(1);
    await user.click(within(run).getByRole("button", { name: "read again" }));
    expect(transport.opens()).toBe(2);
    expect(window.location.pathname).toBe("/contents");
    // The surface stays while the new read runs, and takes the new model.
    expect(screen.getByTestId("contents-hub")).toBeInTheDocument();
    await transport.ready(source);
    expect(screen.getByTestId("contents-hub")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/contents");
  });
});
