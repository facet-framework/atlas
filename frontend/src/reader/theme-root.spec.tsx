/** The Atlas palette on the document root: set by the head script before
 * anything is drawn, and kept there by the running surface. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { taskflowModel } from "@/model/fixtures";
import Atlas from "./Atlas";
import { THEME_KEY } from "./useAtlas";

const script = readFileSync(join(__dirname, "../standalone/theme-init.js"), "utf8");
const head = readFileSync(join(__dirname, "../standalone/index.html"), "utf8").split("</head>")[0];
const root = document.documentElement;

/** Run the head script as the browser does, at `path`, with the system preferring `light`. */
function runHead(path: string, light = false) {
  window.history.replaceState(null, "", path);
  window.matchMedia = ((q: string) => ({
    matches: light ? q.includes("light") : q.includes("dark"),
  })) as unknown as typeof window.matchMedia;
  new Function(script)();
}

beforeEach(() => {
  window.localStorage.clear();
  root.removeAttribute("data-t-theme");
  root.removeAttribute("data-t-mode");
  window.scrollTo = jest.fn();
});

describe("the head script puts the Atlas palette on the root", () => {
  it("is the script the page loads in its head", () => {
    expect(head).toContain('<script src="/theme-init.js"></script>');
    expect(script).toContain(THEME_KEY);
  });

  it("sets the stored palette and mode before the surface exists", () => {
    window.localStorage.setItem(THEME_KEY, JSON.stringify({ theme: "paper", mode: "light" }));
    runHead("/records");
    expect(root).toHaveAttribute("data-t-theme", "paper");
    expect(root).toHaveAttribute("data-t-mode", "light");
  });

  it("takes FACET in the system's mode for nothing stored or an unknown value", () => {
    runHead("/", true);
    expect(root).toHaveAttribute("data-t-theme", "facet");
    expect(root).toHaveAttribute("data-t-mode", "light");
    window.localStorage.setItem(THEME_KEY, JSON.stringify({ theme: '"><x', mode: "light" }));
    runHead("/");
    expect(root).toHaveAttribute("data-t-theme", "facet");
    expect(root).toHaveAttribute("data-t-mode", "dark");
  });

  it("draws a stored plugin theme as FACET in its stored mode until the plugin brings it", () => {
    window.localStorage.setItem(THEME_KEY, JSON.stringify({ theme: "probe:ocean", mode: "light" }));
    runHead("/records");
    expect(root).toHaveAttribute("data-t-theme", "facet");
    expect(root).toHaveAttribute("data-t-mode", "light");
    // A value shaped like a plugin theme but carrying more is not one.
    window.localStorage.setItem(
      THEME_KEY,
      JSON.stringify({ theme: 'probe:ocean"]', mode: "light" }),
    );
    runHead("/records");
    expect(root).toHaveAttribute("data-t-mode", "dark");
  });
});

describe("the running surface keeps the root in step", () => {
  it("writes the chosen palette onto the root and adds no style element", () => {
    window.localStorage.setItem(THEME_KEY, JSON.stringify({ theme: "facet", mode: "dark" }));
    window.history.replaceState(null, "", "/");
    render(<Atlas model={taskflowModel()} readers={null} />);
    expect(root).toHaveAttribute("data-t-mode", "dark");
    const styles = document.querySelectorAll("style").length;
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "/Paper" } });
    fireEvent.click(within(dialog).getByRole("option", { name: /Paper/ }));
    expect(root).toHaveAttribute("data-t-theme", "paper");
    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-t-theme", "paper");
    expect(JSON.parse(window.localStorage.getItem(THEME_KEY)!)).toEqual({
      theme: "paper",
      mode: "dark",
    });
    expect(document.querySelectorAll("style")).toHaveLength(styles);
  });
});
