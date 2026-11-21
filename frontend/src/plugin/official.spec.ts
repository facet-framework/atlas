import { OFFICIAL_PLUGINS } from "./official";

it("bundles the selected reader plugins in navigation order", () => {
  expect(OFFICIAL_PLUGINS.map(({ id }) => id)).toEqual(["adr", "bpmn", "dmn", "wiki"]);
});
