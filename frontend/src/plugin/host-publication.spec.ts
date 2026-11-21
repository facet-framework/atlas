import { PluginHost } from "./host";

const navigation = {} as Parameters<PluginHost["load"]>[2];

describe("plugin publications", () => {
  it("returns only data accepted by the reader and clears a switched-off plugin's values", () => {
    const host = new PluginHost();
    host.load(
      "probe",
      (atlas) => {
        atlas.data.publish("decisions", [{ title: "accepted" }]);
        atlas.data.publish("invalid", [{ title: 42 }]);
      },
      navigation,
    );
    const decisions = (value: unknown): value is { title: string }[] =>
      Array.isArray(value) && value.every((item) => typeof item?.title === "string");

    expect(host.publishedValue("decisions", decisions)).toEqual([{ title: "accepted" }]);
    expect(host.publishedValue("invalid", decisions)).toBeUndefined();

    host.clearPublished("probe");
    expect(host.publishedValue("decisions", decisions)).toBeUndefined();
  });
});
