import { PluginBus } from "./bus";

describe("What a plugin hears and what it may say", () => {
  it("tells a plugin when the corpus has moved", () => {
    const bus = new PluginBus();
    const received: unknown[] = [];
    bus.on("notes", "facets.changed", (p) => received.push(p));

    bus.emitFromHost("facets.changed", ["backend/server/local/registry-reader"]);

    expect(received).toEqual([["backend/server/local/registry-reader"]]);
  });

  it("lets a plugin speak in its own name", () => {
    const bus = new PluginBus();
    const received: unknown[] = [];
    bus.on("concepts", "notes.page-saved", (p) => received.push(p));

    const ok = bus.emit("notes", "notes.page-saved", { address: "a/b" });

    expect(ok).toBe(true);
    expect(received).toEqual([{ address: "a/b" }]);
  });

  it("does not let a plugin speak in another's name", () => {
    const bus = new PluginBus();
    const received: unknown[] = [];
    bus.on("concepts", "notes.page-saved", (p) => received.push(p));

    // Precondition: the listener is registered — otherwise the case would
    // check that nobody is listening instead of that nobody may speak.
    expect(bus.listenerCount).toBe(1);

    const ok = bus.emit("attacker", "notes.page-saved", { address: "forged" });

    expect(ok).toBe(false);
    expect(received).toHaveLength(0);
  });

  it("does not let a plugin fake a host event", () => {
    const bus = new PluginBus();
    const received: unknown[] = [];
    bus.on("concepts", "facets.changed", (p) => received.push(p));

    const ok = bus.emit("notes", "facets.changed", ["invented"]);

    expect(ok).toBe(false);
    expect(received).toHaveLength(0);
  });

  it("does not take the other plugins down with one that throws", () => {
    const bus = new PluginBus();
    const received: string[] = [];
    bus.on("kaputt", "scan.done", () => {
      throw new Error("kaputt");
    });
    bus.on("heil", "scan.done", () => received.push("heil"));

    bus.emitFromHost("scan.done");

    expect(received).toEqual(["heil"]);
  });

  it("unsubscribes whoever unsubscribes", () => {
    const bus = new PluginBus();
    const unsubscribe = bus.on("notes", "scan.done", () => {});
    expect(bus.listenerCount).toBe(1);

    unsubscribe();

    expect(bus.listenerCount).toBe(0);
  });
});
