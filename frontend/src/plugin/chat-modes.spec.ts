/** A plugin contributes a conversation mode — and what it may not take. */

import { PluginHost } from "./host";
import {
  ChatModeRegistry,
  CORE_MODE_IDS,
  CORE_MODE_ID,
  withDefaults,
  type ChatMode,
} from "./chat-modes";
import type { Nav } from "../nav";

const mode = (label: string): ChatMode => ({
  label,
  systemPrompt: `Answer as ${label}.`,
});

function navSpy(): Nav {
  return {
    go: () => {},
    openSheet: () => {},
    closeSheet: () => {},
    openArea: () => {},
    closeArea: () => {},
    openCatalogue: () => {},
    closeCatalogue: () => {},
    openSet: () => {},
    closeSet: () => {},
    openPalette: () => {},
    ask: () => {},
    slash: () => {},
    setRole: () => {},
  } as unknown as Nav;
}

describe("A conversation mode a plugin contributes", () => {
  it("then stands in the list, with the plugin it belongs to", () => {
    const r = new ChatModeRegistry();
    expect(
      r.register("partner", CORE_MODE_IDS, "product-partner", mode("Product-Partner")),
    ).not.toBeNull();

    expect(r.count).toBe(1);
    expect(r.find("product-partner")?.label).toBe("Product-Partner");
    // The name comes from the host and not from the body — the same promise as
    // for slots, commands, areas, settings pages and tiles.
    expect(r.ownerOf("product-partner")).toBe("partner");
  });

  it("disappears when the plugin takes it back", () => {
    const r = new ChatModeRegistry();
    const remove = r.register("partner", CORE_MODE_IDS, "eigener", mode("Eigener"));
    expect(r.has("eigener")).toBe(true);

    remove!();

    expect(r.has("eigener")).toBe(false);
    expect(r.count).toBe(0);
    expect(r.find("eigener")).toBeNull();
  });

  it("cannot take over the core's id", () => {
    const r = new ChatModeRegistry();
    // The case's precondition: "normal" really is the core's. Without it, it
    // would check a lock against a name nobody holds.
    expect(CORE_MODE_IDS.has(CORE_MODE_ID)).toBe(true);

    expect(r.register("boes", CORE_MODE_IDS, CORE_MODE_ID, mode("Not the real one"))).toBeNull();
    expect(r.count).toBe(0);
  });

  it("cannot take over another plugin's id", () => {
    const r = new ChatModeRegistry();
    r.register("first", CORE_MODE_IDS, "shared", mode("the first"));

    expect(r.register("zweit", CORE_MODE_IDS, "shared", mode("the second"))).toBeNull();

    // The first stays. Silently overwriting would make the winner depend on
    // load order, and a reader cannot read load order.
    expect(r.find("shared")?.label).toBe("the first");
    expect(r.ownerOf("shared")).toBe("first");
    expect(r.count).toBe(1);
  });

  it("reports the refusal as a value and not as a throw", () => {
    const r = new ChatModeRegistry();
    // A throw would tear down the plugin's entry point — over a name
    // collision. `areas.register` answers with `false` for the same reason,
    // and a plugin author reads an answer.
    expect(() => r.register("boes", CORE_MODE_IDS, CORE_MODE_ID, mode("x"))).not.toThrow();
  });
});

describe("The way there leads through atlas.chat", () => {
  it("hands the plugin the registration under its own name", () => {
    const host = new PluginHost();
    host.load(
      "partner",
      (atlas) => {
        atlas.chat.mode("product-partner", mode("Product-Partner"));
      },
      navSpy(),
    );

    expect(host.chatModes.ownerOf("product-partner")).toBe("partner");
  });

  it("refuses the core's id through the interface too", () => {
    const host = new PluginHost();
    let reply: unknown = "not run";
    host.load(
      "boes",
      (atlas) => {
        reply = atlas.chat.mode(CORE_MODE_ID, mode("x"));
      },
      navSpy(),
    );

    expect(reply).toBeNull();
    expect(host.chatModes.count).toBe(0);
  });

  it("is empty as long as no plugin has registered a mode", () => {
    // The other half of the promise "the reader is complete without plugins":
    // no additional choice.
    expect(new PluginHost().chatModes.count).toBe(0);
  });
});

describe("What is sent to the agent", () => {
  it("sends the question unchanged when no mode is chosen", () => {
    expect(withDefaults("Where is it counted?", null)).toBe("Where is it counted?");
  });

  it("puts the chosen mode's instruction before the question", () => {
    const chosen = { ...mode("Product-Partner"), id: "product-partner", plugin: "partner" };

    expect(withDefaults("Where is it counted?", chosen)).toBe(
      "Answer as Product-Partner.\n\nWhere is it counted?",
    );
  });
});
