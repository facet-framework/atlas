// @facet: customization/documents/dmn-analysis
// @facet-role: related
export async function request(call, tool, args) {
  const answer = await call(tool, args);
  if (!answer.ok)
    throw new Error(answer.denied || answer.error || "Tool failed");
  return answer.result;
}
export async function listModels(call) {
  const result = await request(call, "repo.list", { dir: "rules" });
  return result.files.filter((f) => f.path.endsWith(".dmn"));
}
export async function readModel(call, path) {
  const result = await request(call, "repo.read", { dir: "rules", path });
  if (typeof result.body !== "string") throw new Error("Model text missing");
  return {
    xml: result.body,
    model: await request(call, "dmn.inspect", { xml: result.body }),
  };
}
// Only structured inputs are eligible. No inference from scenario prose.
export function casesFor(records, path, decision) {
  const cases = [];
  for (const rec of records) {
    const contract = rec.doc?.contract;
    for (const rule of contract?.business_rules || []) {
      if (rule.model !== path || rule.element !== decision) continue;
      for (const sid of rule.scenarios || []) {
        const scenario = contract.scenarios?.find((s) => s.id === sid);
        if (!scenario) continue;
        if (scenario.examples?.length) {
          let inherited;
          scenario.examples.forEach((block, b) => {
            const columns = block.columns || inherited;
            if (!inherited && block.columns) inherited = block.columns;
            (block.rows || []).forEach((row, n) => {
              if (!columns || row.length !== columns.length) return;
              cases.push({
                id: `${rec.id}#${sid}/${b + 1}/${n + 1}`,
                inputs: Object.fromEntries(columns.map((c, i) => [c, row[i]])),
              });
            });
          });
        } else if (scenario.pre_state)
          cases.push({ id: `${rec.id}#${sid}`, inputs: scenario.pre_state });
      }
    }
  }
  return cases;
}
