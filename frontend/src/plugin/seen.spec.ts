import { SEEN_KEY, Seen, placeKey } from "./seen";
import { SlotRegistry } from "./slots";
import type { PlacePublic } from "./context";

function storageResult(start: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(start));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

const PLACE: PlacePublic = { depth: 0, fid: null, sid: null, role: "development", area: null };

describe("Seen", () => {
  // Mutation: let markiere skip adding the key → red.
  it("calls every place new until it is marked", () => {
    const g = new Seen(storageResult());
    expect(g.isNew("notes:header.action")).toBe(true);
    g.mark("notes:header.action");
    expect(g.isNew("notes:header.action")).toBe(false);
  });

  // Mutation: drop the setItem in schreibe → red.
  it("remembers across a fresh host", () => {
    const store = storageResult();
    new Seen(store).mark("notes:header.action");
    expect(new Seen(store).isNew("notes:header.action")).toBe(false);
  });

  // Mutation: forget every key in vergiss → red (a plugin that is on
  // glows again); forget none → red.
  it("forgets only the places of a plugin that is switched off", () => {
    const g = new Seen(storageResult());
    g.mark("notes:header.action");
    g.mark("adr:settings.adr");
    g.forget(["adr"]);
    expect(g.isNew("notes:header.action")).toBe(false);
    expect(g.isNew("adr:settings.adr")).toBe(true);
  });

  // Mutation: drop the try/catch in lies → red (the constructor throws).
  it("reads unreadable memory as nothing seen", () => {
    const g = new Seen(storageResult({ [SEEN_KEY]: "{kaputt" }));
    expect(g.isNew("notes:header.action")).toBe(true);
  });

  // Mutation: swap the branches in setze (call markiere for on:true and the
  // delete for on:false) → red on both assertions.
  it("lets ui.notify set a place new again, or seen, from outside a click", () => {
    const g = new Seen(storageResult());
    g.mark("notes:header.action");
    g.set("notes:header.action", true);
    expect(g.isNew("notes:header.action")).toBe(true);
    g.set("notes:header.action", false);
    expect(g.isNew("notes:header.action")).toBe(false);
  });

  // Mutation: drop the `!this.keys.has(key)` guard in setze → red (writes,
  // and notifies subscribers, for a place that was already new).
  it("does nothing when ui.notify asks for a place that is already new", () => {
    const g = new Seen(storageResult());
    const l = jest.fn();
    g.subscribe(l);
    g.set("notes:header.action", true);
    expect(l).not.toHaveBeenCalled();
  });

  // Mutation: drop the listener loop in schreibe → red.
  it("tells its subscribers when a place is seen", () => {
    const g = new Seen(storageResult());
    const l = jest.fn();
    g.subscribe(l);
    const previous = g.version();
    g.mark("notes:header.action");
    expect(l).toHaveBeenCalledTimes(1);
    expect(g.version()).not.toBe(previous);
  });
});

describe("The host's glow beside a slot", () => {
  function registration(g: Seen) {
    const reg = new SlotRegistry();
    reg.register("notes", "header.action", (root) => {
      const b = document.createElement("button");
      b.textContent = "Notes";
      root.appendChild(b);
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    reg.mount(host, "header.action", PLACE, g);
    return host;
  }

  // Mutation: skip the glow when istNeu is true → red.
  it("stands after a slot nobody has used yet, outside the plugin's root", () => {
    const host = registration(new Seen(storageResult()));
    const holder = host.querySelector('[data-plslot="notes:header.action"]');
    const glow = host.querySelector('[data-testid="slot-glow-notes:header.action"]');
    expect(holder).not.toBeNull();
    expect(glow).not.toBeNull();
    expect(holder!.nextElementSibling).toBe(glow);
  });

  // Mutation: drop the click listener → red.
  it("goes out on a click inside the slot, and stays out", () => {
    const store = storageResult();
    const host = registration(new Seen(store));
    (host.querySelector('[data-plslot="notes:header.action"]') as HTMLElement).click();
    expect(host.querySelector('[data-testid="slot-glow-notes:header.action"]')).toBeNull();
    expect(registration(new Seen(store)).querySelector('[data-testid^="slot-glow-"]')).toBeNull();
  });

  // Mutation: drop the focusin listener → red.
  it("goes out when the slot takes the focus", () => {
    const host = registration(new Seen(storageResult()));
    const holder = host.querySelector('[data-plslot="notes:header.action"]') as HTMLElement;
    holder.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(host.querySelector('[data-testid="slot-glow-notes:header.action"]')).toBeNull();
  });

  // Mutation: `if (seen?.isNew(key) ?? true)` → red.
  it("is not drawn without a memory to ask", () => {
    const reg = new SlotRegistry();
    reg.register("notes", "header.action", () => {});
    const host = document.createElement("div");
    reg.mount(host, "header.action", PLACE);
    expect(host.querySelector('[data-testid^="slot-glow-"]')).toBeNull();
    expect(placeKey("notes", "header.action")).toBe("notes:header.action");
  });

  it("puts out every glow of the place when one instance is used", () => {
    const g = new Seen(storageResult());
    const firstItem = registration(g);
    const secondItem = registration(g);
    // Precondition: both instances glow.
    expect(
      secondItem.querySelector('[data-testid="slot-glow-notes:header.action"]'),
    ).not.toBeNull();
    (firstItem.querySelector('[data-plslot="notes:header.action"]') as HTMLElement).click();
    expect(secondItem.querySelector('[data-testid="slot-glow-notes:header.action"]')).toBeNull();
  });

  it("lights up an already-mounted slot when ui.notify asks for it", () => {
    const reg = new SlotRegistry();
    const g = new Seen(storageResult());
    reg.register("notes", "header.action", () => {});
    const host = document.createElement("div");
    document.body.appendChild(host);
    reg.mount(host, "header.action", PLACE, g);
    // Precondition: seeing it once already put the dot out.
    host.querySelector('[data-plslot="notes:header.action"]')!.dispatchEvent(new Event("click"));
    expect(host.querySelector('[data-testid^="slot-glow-"]')).toBeNull();

    reg.notify("notes:header.action", true, g);

    const glow = host.querySelector('[data-testid="slot-glow-notes:header.action"]');
    expect(glow).not.toBeNull();
    expect(g.isNew("notes:header.action")).toBe(true);
  });

  // Mutation: drop the `on: false` branch's removal loop in notify → red
  // (the dot never goes out, even though it was told to).
  it("puts an already-mounted slot's glow out when ui.notify clears it", () => {
    const g = new Seen(storageResult());
    const host = registration(g);
    expect(host.querySelector('[data-testid^="slot-glow-"]')).not.toBeNull();

    new SlotRegistry().notify("notes:header.action", false, g);

    expect(host.querySelector('[data-testid^="slot-glow-"]')).toBeNull();
    expect(g.isNew("notes:header.action")).toBe(false);
  });

  // Mutation: drop the `nextElementSibling` already-glowing guard → red
  // (a second dot is added beside the first).
  it("does not double a slot's glow when ui.notify is asked twice", () => {
    const reg = new SlotRegistry();
    const g = new Seen(storageResult());
    reg.register("notes", "header.action", () => {});
    const host = document.createElement("div");
    document.body.appendChild(host);
    reg.mount(host, "header.action", PLACE); // no gesehen: mounts without a dot
    reg.notify("notes:header.action", true, g);
    reg.notify("notes:header.action", true, g);
    expect(host.querySelectorAll('[data-testid^="slot-glow-"]')).toHaveLength(1);
  });
});
