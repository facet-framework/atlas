import { word, control, action } from "./assets/presentation.js";
import { listModels, readModel, request, casesFor } from "./assets/data.js";
import { renderReport, renderTable } from "./assets/view.js";
import { Button, EmptyState, Field } from "@facet-tools/ui";
import { PluginHead } from "../../../frontend/src/plugin/components";
// @facet: customization/documents/dmn-analysis
// @facet-role: primary
export default function dmn(atlas) {
  const { h, react: React } = atlas.ui;
  function Page({ state, setState }) {
    const [files, setFiles] = React.useState(null);
    const [loaded, setLoaded] = React.useState(null);
    const [report, setReport] = React.useState(null);
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const generation = React.useRef(0);
    const path = typeof state === "string" ? state : "";
    const [decision, setDecision] = React.useState("");
    React.useEffect(() => {
      let alive = true;
      listModels(atlas.bus.call).then(
        (f) => {
          if (alive) setFiles(f);
        },
        (e) => {
          if (alive) setError(e.message);
        },
      );
      return () => {
        alive = false;
      };
    }, []);
    React.useEffect(() => {
      let alive = true;
      generation.current++;
      setLoaded(null);
      setReport(null);
      setError("");
      setBusy(false);
      if (path)
        readModel(atlas.bus.call, path).then(
          (r) => {
            if (alive) {
              setLoaded(r);
              setDecision(r.model.decisions[0]?.id || "");
            }
          },
          (e) => {
            if (alive) setError(e.message);
          },
        );
      return () => {
        alive = false;
        generation.current++;
      };
    }, [path]);
    async function analyze() {
      const current = ++generation.current;
      setBusy(true);
      setError("");
      setReport(null);
      try {
        const records = atlas.data.v.M.map((f) => f.rec).filter(Boolean);
        const result = await request(atlas.bus.call, "dmn.analyze", {
          xml: loaded.xml,
          decision,
          cases: casesFor(records, `rules/${path}`, decision),
        });
        if (current === generation.current) setReport(result);
      } catch (e) {
        if (current === generation.current) setError(e.message);
      } finally {
        if (current === generation.current) setBusy(false);
      }
    }
    const selected = loaded?.model.decisions.find((d) => d.id === decision);
    return h(
      "div",
      {
        className: "t-page",
        style: {
          maxWidth: "100%",
          minWidth: 0,
          color: "var(--t-ink, inherit)",
          display: "grid",
          gap: 20,
        },
      },
      h(PluginHead, { icon: "flow", title: "DMN" }),
      files?.length
        ? h(Field, { label: word("Model") }, (id) =>
            h(
              "div",
              { id, className: "t-row t-row--wrap", role: "listbox" },
              ...(files || []).map((f) =>
                h(
                  Button,
                  {
                    key: f.path,
                    type: "button",
                    variant: path === f.path ? "primary" : "quiet",
                    role: "option",
                    "aria-selected": path === f.path,
                    onClick: () => setState(f.path),
                  },
                  f.path,
                ),
              ),
            ),
          )
        : null,
      files?.length === 0 &&
        !error &&
        h(
          "div",
          { "data-testid": "dmn-empty" },
          h(EmptyState, {
            icon: "flow",
            title: word("No DMN models"),
          }),
        ),
      error && h("p", { role: "alert" }, error),
      loaded &&
        h(
          "label",
          null,
          word("Decision") + " ",
          h(
            "select",
            {
              style: control,
              value: decision,
              onChange: (e) => {
                generation.current++;
                setDecision(e.target.value);
                setReport(null);
                setBusy(false);
              },
            },
            ...loaded.model.decisions.map((d) =>
              h("option", { key: d.id, value: d.id }, d.name || d.id),
            ),
          ),
        ),
      renderTable(h, selected),
      loaded &&
        h(
          "button",
          {
            style: action,
            type: "button",
            disabled: busy || !decision,
            onClick: analyze,
          },
          word(busy ? "Analyzing…" : "Find scenario candidates"),
        ),
      renderReport(h, report),
    );
  }
  atlas.areas.register("dmn", (ctx) => h(Page, ctx), {
    initial: (arg) => arg || "",
    place: (state) => state,
  });
}
