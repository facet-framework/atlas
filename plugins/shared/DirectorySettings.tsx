import { useEffect, useState } from "react";
import { tx } from "../../frontend/src/i18n";

type Location = { file: string; line: number; directory: string; key: string };
type Saved = { file: string; dirty: boolean; worktree: string; branch: string };
async function request(body: unknown) {
  const response = await fetch("/api/settings/directory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

export function DirectorySettings({ kind }: { kind: "adr" | "bpmn" }) {
  const [location, setLocation] = useState<Location | null>(null);
  const [directory, setDirectory] = useState("");
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    request({ kind })
      .then((value: Location) => {
        if (alive) {
          setLocation(value);
          setDirectory(value.directory);
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [kind]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      setSaved(await request({ kind, directory, mode }));
      setEditing(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <p>
        {tx("ui.shared.directorysettings-configuration")}{" "}
        <code>
          {location?.file ?? ".facetrc.yaml"}
          {location?.line ? `:${location.line}` : ""}
        </code>
      </p>
      <p>
        <code>{kind}.directory</code>
        {location && !location.line
          ? ` ${tx("ui.shared.directorysettings-not-set-yet-add-following-entry")}`
          : ` ${tx("ui.shared.directorysettings-sets-directory")}`}
      </p>
      <pre>{`${kind}:\n  directory: ${location?.directory ?? `docs/${kind}`}`}</pre>
      <button
        type="button"
        onClick={() => {
          setEditing(!editing);
          setMode("");
        }}
      >
        {tx("ui.shared.directorysettings-change-through-atlas")}
      </button>
      {editing && (
        <div>
          <label>
            {tx("ui.shared.directorysettings-directory-relative-repository")}{" "}
            <input
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
              disabled={busy}
            />
          </label>
          <fieldset disabled={busy}>
            <legend>
              {tx(
                "ui.shared.directorysettings-how-do-you-want-change-configuration",
              )}
            </legend>
            <label>
              <input
                type="radio"
                name={`${kind}-mode`}
                value="checkout"
                checked={mode === "checkout"}
                onChange={(e) => setMode(e.target.value)}
              />
              {tx(
                "ui.shared.directorysettings-change-main-checkout-file-may-then",
              )}
            </label>
            <label>
              <input
                type="radio"
                name={`${kind}-mode`}
                value="worktree"
                checked={mode === "worktree"}
                onChange={(e) => setMode(e.target.value)}
              />
              {tx(
                "ui.shared.directorysettings-create-separate-worktree-branch-integrate-change",
              )}
            </label>
          </fieldset>
          <button
            type="button"
            disabled={busy || !mode || !directory}
            onClick={save}
          >
            {busy
              ? tx("ui.shared.directorysettings-saving")
              : tx("ui.shared.directorysettings-save")}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && (
        <div role="status">
          <p>
            {tx("ui.shared.directorysettings-saved")} <code>{saved.file}</code>
          </p>
          {saved.dirty && (
            <p>
              {tx(
                "ui.shared.directorysettings-configuration-file-now-contains-uncommitted-changes",
              )}
            </p>
          )}
          {saved.branch ? (
            <>
              <p>
                {tx("ui.shared.directorysettings-worktree")}{" "}
                <code>{saved.worktree}</code>
                <br />
                {tx("ui.shared.directorysettings-branch")}{" "}
                <code>{saved.branch}</code>
              </p>
              <p>
                {tx(
                  "ui.shared.directorysettings-worktree-review-change-commit-push-branch",
                )}
              </p>
              <pre>{`cd ${"'" + saved.worktree.replaceAll("'", "'\"'\"'") + "'"}\ngit add .facetrc.yaml\ngit commit -m "Configure ${kind} directory"\ngit push -u origin ${saved.branch}`}</pre>
            </>
          ) : (
            <p>
              {tx(
                "ui.shared.directorysettings-reload-page-use-configured-directory",
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
