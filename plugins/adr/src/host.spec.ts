import { loadModel } from "./model/load";
import { AdrHostError, listAdrFiles, readAdrFile } from "./host";
import type { Call } from "./host";

describe("listAdrFiles", () => {
  it("asks the host for the configured ADR directory and answers its files", async () => {
    const call = jest.fn(async () => ({
      ok: true,
      result: {
        dir: "docs/adr",
        files: [{ path: "0001-x.md", number: "0001", slug: "x" }],
      },
    })) as unknown as Call;

    const files = await listAdrFiles(call);

    expect(call).toHaveBeenCalledWith("repo.list", {});
    expect(files).toEqual([{ path: "0001-x.md", number: "0001", slug: "x" }]);
  });

  it("throws an AdrHostError naming the tool when the host denies it", async () => {
    const call = jest.fn(async () => ({
      ok: false,
      denied: "plugin adr not installed",
    })) as unknown as Call;

    await expect(listAdrFiles(call)).rejects.toThrow(AdrHostError);
    await expect(listAdrFiles(call)).rejects.toThrow(
      "plugin adr not installed",
    );
  });
});

describe("readAdrFile", () => {
  it("calls repo.read with docs/adr and the given path and answers the body", async () => {
    const call = jest.fn(async () => ({
      ok: true,
      result: { path: "0001-x.md", body: "# ADR 0001" },
    })) as unknown as Call;

    const body = await readAdrFile(call, "0001-x.md");

    expect(call).toHaveBeenCalledWith("repo.read", {
      dir: "docs/adr",
      path: "0001-x.md",
    });
    expect(body).toBe("# ADR 0001");
  });

  it("throws an AdrHostError with the tool's own error text when it fails", async () => {
    const call = jest.fn(async () => ({
      ok: false,
      error: "no such file",
    })) as unknown as Call;

    await expect(readAdrFile(call, "9999-nope.md")).rejects.toThrow(
      "no such file",
    );
  });
});

describe("the configured ADR directory", () => {
  it("loads files and their bodies from the directory returned by the host", async () => {
    const call = jest.fn(async (tool: string) =>
      tool === "repo.list"
        ? {
            ok: true,
            result: {
              dir: "architecture/decisions",
              files: [{ path: "0001-new.md", number: "0001", slug: "new" }],
            },
          }
        : {
            ok: true,
            result: { body: "# Configured decision\n**Status:** accepted\n" },
          },
    ) as unknown as Call;
    const model = await loadModel(call);
    expect(call).toHaveBeenCalledWith("repo.list", {});
    expect(call).toHaveBeenCalledWith("repo.read", {
      dir: "architecture/decisions",
      path: "0001-new.md",
    });
    expect(model.directory).toBe("architecture/decisions");
    expect(model.entries[0].title).toBe("Configured decision");
  });
});
