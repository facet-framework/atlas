import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import dmn from "./plugin.js";
import { inEnglish } from "../../shared/language.spec-support";

inEnglish();

it("opens a model, renders its table and requests concrete candidates", async () => {
  type Renderer = (ctx: {
    state: string;
    setState: (s: string) => void;
  }) => React.ReactNode;
  let renderer: Renderer = () => null;
  const call = jest.fn(async (tool: string) => ({
    ok: true,
    result:
      tool === "repo.list"
        ? { files: [{ path: "prices.dmn" }] }
        : tool === "repo.read"
          ? { body: "<model/>" }
          : tool === "dmn.inspect"
            ? {
                decisions: [
                  {
                    id: "discount",
                    name: "Discount",
                    table: {
                      hit_policy: "UNIQUE",
                      inputs: [
                        {
                          expression: { text: "amount" },
                          values: { text: "[0..200]" },
                        },
                      ],
                      outputs: [{ name: "discount" }],
                      rules: [
                        {
                          id: "r1",
                          inputs: [{ text: "< 100" }],
                          outputs: [{ text: "5" }],
                        },
                      ],
                    },
                  },
                ],
              }
            : {
                status: "analyzed",
                cells: 5,
                finding_count: 1,
                sha256: "source-digest",
                reasons: [],
                findings: [
                  {
                    kind: "gap",
                    message: "Missing boundary",
                    inputs: { amount: 100 },
                  },
                ],
                cases: [],
              },
  }));
  const record = {
    id: "shop/cart/discount",
    doc: {
      contract: {
        business_rules: [
          {
            model: "rules/prices.dmn",
            element: "discount",
            scenarios: ["small"],
          },
        ],
        scenarios: [{ id: "small", pre_state: { amount: 50 } }],
      },
    },
  };
  dmn({
    ui: { h: React.createElement, react: React },
    areas: {
      register: (_id: string, r: Renderer) => {
        renderer = r;
      },
    },
    bus: { call },
    data: { v: { M: [{ rec: record }] } },
  });
  function Host() {
    const [state, setState] = React.useState("");
    return renderer({ state, setState });
  }
  render(<Host />);
  await screen.findByRole("option", { name: "prices.dmn" });
  fireEvent.click(screen.getByRole("option", { name: "prices.dmn" }));
  expect(
    await screen.findByRole("heading", { name: "Discount" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "< 100" })).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Find scenario candidates" }),
  );
  expect(await screen.findByText("Missing boundary")).toBeInTheDocument();
  expect(screen.getByText(/"amount": 100/)).toBeInTheDocument();
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("dmn.analyze", {
      xml: "<model/>",
      decision: "discount",
      cases: [{ id: "shop/cart/discount#small", inputs: { amount: 50 } }],
    }),
  );
});

it("renders the shared empty state when no models exist", async () => {
  let renderer: (ctx: {
    state: string;
    setState: (value: string) => void;
  }) => React.ReactNode = () => null;
  dmn({
    ui: { h: React.createElement, react: React },
    areas: {
      register: (
        _id: string,
        next: (ctx: {
          state: string;
          setState: (value: string) => void;
        }) => React.ReactNode,
      ) => {
        renderer = next;
      },
    },
    bus: { call: jest.fn(async () => ({ ok: true, result: { files: [] } })) },
    data: { v: { M: [] } },
  });
  render(renderer({ state: "", setState: jest.fn() }));
  expect(await screen.findByTestId("dmn-empty")).toHaveTextContent(
    "No DMN models",
  );
  expect(screen.getByRole("heading", { name: "DMN" })).toBeInTheDocument();
  expect(screen.queryByRole("listbox", { name: "Model" })).toBeNull();
});
