/** The register behind "/" in the question field. */

import { CommandRegistry, splitCommand, type SlashCommand } from "./commands";

const cmd = (command: string, extra: Partial<SlashCommand> = {}): SlashCommand => ({
  command,
  purpose: "does " + command,
  group: "Chat",
  run: () => {},
  ...extra,
});

describe("CommandRegistry", () => {
  it("offers what was registered, host and plugin alike", () => {
    const registry = new CommandRegistry();

    registry.register("atlas", cmd("/new"));
    registry.register("notes", cmd("/notes", { argument: "page", group: "Notes" }));

    expect(registry.list().map((entry) => entry.command)).toEqual(["/new", "/notes"]);
    expect(registry.list().map((entry) => entry.plugin)).toEqual(["atlas", "notes"]);
  });

  it("forgets a plugin's command when the plugin unregisters it", () => {
    const registry = new CommandRegistry();
    registry.register("atlas", cmd("/new"));
    const remove = registry.register("notes", cmd("/notes"));

    // The precondition: it really was there, so the absence below is the
    // removal and not a registration that never happened.
    expect(registry.exact("/notes")).toBeDefined();

    remove();

    expect(registry.exact("/notes")).toBeUndefined();
    expect(registry.list().map((entry) => entry.command)).toEqual(["/new"]);
  });

  it("removes only the registration that asked, however often it is called", () => {
    const registry = new CommandRegistry();
    const removeFirst = registry.register("notes", cmd("/notes"));
    registry.register("adr", cmd("/adr"));

    removeFirst();
    removeFirst();

    // A remover that ran twice must not take the next registration with it:
    // it holds its own entry, never an index into a list that has moved.
    expect(registry.list().map((entry) => entry.command)).toEqual(["/adr"]);
  });

  it("matches the purpose and the group, not only the command", () => {
    const registry = new CommandRegistry();
    registry.register("atlas", cmd("/record", { purpose: "Open record", group: "Records" }));
    registry.register("notes", cmd("/notes", { purpose: "Side open", group: "Notes" }));

    // The reader who remembers "the notes one" and not its name is the reader
    // this list is for.
    expect(registry.find("notes").map((entry) => entry.command)).toEqual(["/notes"]);
    expect(registry.find("open").map((entry) => entry.command)).toEqual(["/record", "/notes"]);
    expect(registry.find("Records").map((entry) => entry.command)).toEqual(["/record"]);
  });

  it("says when nothing matches rather than falling back to everything", () => {
    const registry = new CommandRegistry();
    registry.register("atlas", cmd("/new"));

    expect(registry.find("zzz")).toEqual([]);
    // An empty query is the other case: the whole list, not none of it.
    expect(registry.find("")).toHaveLength(1);
  });

  it("tells a listener when the set changes", () => {
    const registry = new CommandRegistry();
    let told = 0;
    const stop = registry.subscribe(() => {
      told += 1;
    });

    const remove = registry.register("notes", cmd("/notes"));
    expect(told).toBe(1);
    remove();
    expect(told).toBe(2);

    stop();
    registry.register("adr", cmd("/adr"));
    // A list that unmounted must stop being told, or it renders into nothing.
    expect(told).toBe(2);
  });
});

describe("splitCommand", () => {
  it("is nothing at all when the field does not start with a slash", () => {
    expect(splitCommand("where is it")).toBeNull();
    expect(splitCommand("")).toBeNull();
  });

  it("is still being typed while there is no space", () => {
    expect(splitCommand("/wik")).toEqual({ command: "/wik", argument: "" });
  });

  it("is a command and an empty argument once the space is there", () => {
    // This is what lets a reader who types the whole name never see the list.
    expect(splitCommand("/notes ")).toEqual({ command: "/notes", argument: "" });
  });

  it("keeps the argument's own spaces", () => {
    expect(splitCommand("/adr-new A title with words")).toEqual({
      command: "/adr-new",
      argument: "A title with words",
    });
  });
});
