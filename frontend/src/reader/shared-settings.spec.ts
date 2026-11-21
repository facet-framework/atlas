import { readStored, STORAGE_KEY } from "@/state";
import { readShared, saveShared, withRole, writeShared } from "./shared-settings";

function memory(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(STORAGE_KEY, initial);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    raw: () => data.get(STORAGE_KEY),
  };
}

describe("settings shared through the stored reader state", () => {
  it("reads the stored fields and drops what the stored-state reader would drop", () => {
    const store = memory(JSON.stringify({ generativeOn: ["dev", 3], pluginsOff: ["adr", 4] }));
    expect(readShared(store)).toEqual({
      generativeOn: ["dev"],
      pluginsOff: ["adr"],
    });
    const none = { generativeOn: [], pluginsOff: [] };
    expect(readShared(null)).toEqual(none);
    expect(readShared(memory("not json"))).toEqual(none);
  });

  it("writes only its own fields, and the stored-state reader sees them", () => {
    const store = memory(JSON.stringify({ role: "review", skin: "paper" }));
    expect(writeShared({ pluginsOff: ["adr"], generativeOn: ["newcomer"] }, store)).toBe(true);
    expect(JSON.parse(store.raw()!)).toEqual({
      role: "review",
      skin: "paper",
      pluginsOff: ["adr"],
      generativeOn: ["newcomer"],
    });
    expect(readStored(store)).toMatchObject({ pluginsOff: ["adr"], generativeOn: ["newcomer"] });
  });

  it("says false when there is no storage or the browser refuses the write", () => {
    expect(writeShared({ pluginsOff: ["adr"] }, null)).toBe(false);
    const full = {
      getItem: () => "{}",
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(writeShared({ pluginsOff: ["adr"] }, full)).toBe(false);
    const broken = memory("[1");
    expect(writeShared({ pluginsOff: ["adr"] }, broken)).toBe(false);
    expect(broken.raw()).toBe("[1");
  });

  it("names why a shared setting was not stored", () => {
    expect(saveShared({ pluginsOff: ["adr"] }, null)).toBe("no-storage");
    const full = {
      getItem: () => "{}",
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(saveShared({ pluginsOff: ["adr"] }, full)).toBe("refused");
    const blocked = {
      getItem: () => {
        throw new Error("security");
      },
      setItem: () => undefined,
    };
    expect(saveShared({ pluginsOff: ["adr"] }, blocked)).toBe("refused");
    const broken = memory("[1");
    expect(saveShared({ pluginsOff: ["adr"] }, broken)).toBe("unreadable");
    expect(broken.raw()).toBe("[1");
    expect(saveShared({ pluginsOff: ["adr"] }, memory("{}"))).toBeNull();
  });

  it("leaves stored JSON that is not an object untouched", () => {
    for (const stored of ["null", "42", '"settings"', '["dev"]']) {
      const store = memory(stored);
      expect(saveShared({ pluginsOff: ["adr"] }, store)).toBe("unreadable");
      expect(store.raw()).toBe(stored);
    }
  });

  it("switches one role without duplicating or reordering the others", () => {
    expect(withRole(["dev", "newcomer"], "dev", true)).toEqual(["dev", "newcomer"]);
    expect(withRole(["dev"], "newcomer", true)).toEqual(["dev", "newcomer"]);
    expect(withRole(["dev", "newcomer"], "dev", false)).toEqual(["newcomer"]);
  });
});
