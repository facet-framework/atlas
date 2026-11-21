/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 * @facet: customization/documents/wiki-plugin
 * @facet-role: primary
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { tx } from "../../../../frontend/src/i18n";
import { richText } from "./mono";
import {
  FACETRC,
  FORGE_FROM_REMOTE,
  repoWithoutGit as repoWithoutGit,
} from "../../../../frontend/src/plugin/components";
import { useCall } from "../bus";
import {
  createWiki,
  readWikiState,
  wikiBranchName,
  type WikiCreated,
  type RepoState,
  type WikiCreateStep,
} from "./host";
import "../wiki.css";

/** The segment grammar every address component follows (the specification). */
const SEGMENT = /^[a-z][a-z0-9-]*$/;

/**
 * Title → file name, the **same** transliteration as `WikiSlug` in the host.
 *
 * "Same" is a claim: replacement applies only
 * the four German umlauts, so "Café" became `caf` here and `cafe` in the
 * host — the footer command therefore named a **different** file than the
 * button wrote. The table below is the host's, character for character.
 *
 * Lossy, and the loss is shown, not hidden: the surface writes out the
 * derived path before it creates it.
 *
 * Still the second implementation of a rule the host has — unlike with the
 * front matter, this cannot be avoided here because the path is needed
 * *before* anyone asks the host. What helps against that is a test that
 * measures both sides against the same titles.
 */
const TRANSLITERATION: Array<[RegExp, string]> = [
  [/\u00e4/g, "ae"],
  [/\u00f6/g, "oe"],
  [/\u00fc/g, "ue"],
  [/\u00df/g, "ss"],
  [/[àáâ]/g, "a"],
  [/[éèê]/g, "e"],
  [/[íì]/g, "i"],
  [/[óòô]/g, "o"],
  [/[úù]/g, "u"],
  [/ç/g, "c"],
  [/ñ/g, "n"],
];

export function slugOf(title: string): string {
  // Lowercase first, as in the host: its table also handles uppercase because it
  // applies before lowercasing; after `toLowerCase()` the lowercase form is
  // enough.
  let lowered = title.toLowerCase().trim();
  for (const [pattern, replacement] of TRANSLITERATION) {
    lowered = lowered.replace(pattern, replacement);
  }
  return lowered
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "");
}

/**
 * What the steps are called while they run.
 *
 * Two tables and not one with a special case: the first step is named the
 * same in the host both times (the tool `repo.branch`), but does different
 * things — once branch and worktree, once nothing at all, because the target
 * is ignored. "Branch and worktree are being created" would there be a label
 * for an action that does not take place.
 *
 * The second table has only the two steps that run without versioning.
 * Commit and push do not appear there — not because they are being skipped,
 * but because there is nothing to commit and nothing to push.
 */
const RUNNING: Record<WikiCreateStep, () => string> = {
  branch: () => tx("ui.wiki-src-wiki.create-creating-branch-worktree"),
  page: () => tx("ui.wiki-src-wiki.create-writing-page"),
  commit: () => tx("ui.wiki-src-wiki.create-committing"),
  pr: () => tx("ui.wiki-src-wiki.create-pushing"),
};

const RUNNING_WITHOUT_GIT: Partial<Record<WikiCreateStep, () => string>> = {
  branch: () => tx("ui.wiki-src-wiki.create-asking-host"),
  page: () => tx("ui.wiki-src-wiki.create-writing-page"),
};

/**
 * The label of the currently running step.
 *
 * The fallback to `RUNNING` is not a courtesy but the honest answer to a
 * state that should not occur: if a commit or a push does run without
 * versioning, this surface has misunderstood something — and an empty label
 * would tell the reader nothing about it, while "Committing
 * …") at least names what is being waited on.
 */
function runningLabel(step: WikiCreateStep, withoutGit: boolean): string {
  return (
    (withoutGit ? RUNNING_WITHOUT_GIT[step] : undefined) ?? RUNNING[step]
  )();
}

export default function Create({
  dir,
  onCancel,
  onCreated,
}: {
  /** Where the wiki will live — from the corpus, until the host answers. */
  dir: string;
  onCancel: () => void;
  onCreated?: (result: WikiCreated) => void;
}) {
  const call = useCall();
  const [area, setArea] = useState("onboarding");
  const [title, setTitle] = useState("");
  const [host, setHost] = useState<RepoState | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [running, setRunning] = useState<WikiCreateStep | null>(null);
  const [result, setResult] = useState<WikiCreated | null>(null);

  /*
   * Esc leads back to the empty state, not out of the area entirely.
   *
   * The wiki's Esc ladder (page → front page → gone) hangs off the document
   * and cannot know anything about this state — it lives in `Wiki`. Without
   * this hook, Esc would therefore close the whole area and take a
   * half-filled form with it; but the ladder has one rung per view, and this
   * surface is one.
   *
   * In the capture phase, so it runs ahead of the ladder and `stopPropagation`
   * reaches it — and only while nothing is running: creating a branch while
   * leaving the surface would mean leaving the run unsupervised.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || running !== null) return;
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel, running]);

  // Asked once when opening, so the hint stands **before** the question and
  // not behind the button — the same courtesy that `GET /api/companion/state`
  // gives specifically for this (the specification).
  useEffect(() => {
    let live = true;
    readWikiState(call).then(
      (state) => live && setHost(state),
      (caught: unknown) =>
        live &&
        setHostError(caught instanceof Error ? caught.message : String(caught)),
    );
    return () => {
      live = false;
    };
  }, [call]);

  const slug = slugOf(title);
  const areaSlug = slugOf(area);
  const path = `${areaSlug || "…"}/${slug || "…"}.md`;
  // Where the wiki comes into being is what the host says. As long as it
  // hasn't answered, "…" stands here and no default path: a literal would be
  // a location nobody measured — wrong in exactly the repository that keeps
  // its records elsewhere, and permanently wrong after a failure. `dir` is
  // what the corpus reported, and it reports nothing for a project without a
  // wiki.
  const where = host?.wikiDir || dir || "…";
  const measured = Boolean(host?.wikiDir || dir);

  const withoutGit = repoWithoutGit(host);
  // The problem is a sentence, and a memo would keep the one of the language
  // it was computed in.
  const { i18n } = useTranslation();

  const problem = useMemo(() => {
    if (host?.gitError) return host.gitError;
    if (host?.initialization)
      return tx(
        "ui.wiki-src-wiki.create-wiki-sub-repository-not-initialised-command",
        {
          command: host.initialization.command,
        },
      );
    if (!areaSlug || !SEGMENT.test(areaSlug))
      return tx("ui.wiki-src-wiki.create-area-needs-name-made-z-0");
    if (!title.trim())
      return tx("ui.wiki-src-wiki.create-title-required-only-thing");
    if (!slug)
      return tx(
        "ui.wiki-src-wiki.create-no-file-name-segment-grammar-results",
        {
          title: title.trim(),
        },
      );
    // No git blocks nothing here anymore. What remains is the one obstacle
    // that really is not one, but a statement of fact: where a wiki already
    // lives, there is nothing left to create.
    if (host?.wiki)
      return tx(
        "ui.wiki-src-wiki.create-project-already-has-wiki-there-nothing",
      );
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the language is read through tx(); a language switch must recompute the sentence.
  }, [areaSlug, host, slug, title, i18n.language]);

  // The equivalent command is the same one — `facet wiki new` has always
  // written straight into the checkout and never created a branch. Exactly
  // the absence of a redundant button.
  const command = `facet wiki new --area=${areaSlug || "…"} "${title.trim() || "…"}"`;

  async function run() {
    if (problem || running) return;
    const branch = wikiBranchName(slug);
    setResult(null);
    // Every step shows on screen **while** it runs — not just the first one.
    // `createWiki` reports it before doing it; a surface that instead set
    // "branch" once and then stayed that way for four calls would say
    // something wrong three times over and hold up three labels that never
    // appear.
    setRunning("branch");
    const out = await createWiki(
      {
        branch,
        path: `${areaSlug}/${slug}.md`,
        // Fields, not finished YAML: the host has the quoting rule, and a
        // title with a colon, a hash sign, or "true" in it would break every
        // second implementation of that rule.
        front: { title: title.trim(), status: "draft" },
        message: `docs(wiki): ${title.trim()}`,
        title: `docs(wiki): ${title.trim()}`,
      },
      call,
      setRunning,
    );
    setRunning(null);
    setResult(out);
    onCreated?.(out);
  }

  if (result)
    return <Result result={result} where={where} onCancel={onCancel} />;

  return (
    <article className="wiki-create">
      <div className="wiki-create__card">
        <p className="t-eyebrow">{tx("ui.wiki-src-wiki.create-create-wiki")}</p>
        <h1 className="t-h2">
          {tx("ui.wiki-src-wiki.create-wiki-comes-into-being-its-first")}
        </h1>
        <p className="wiki-create__lead">
          {measured
            ? richText(
                "ui.wiki-src-wiki.create-folder-where-created-file",
                { where },
                { where: "mono" },
              )
            : tx("ui.wiki-src-wiki.create-host-says-where-will-created-moment")}
        </p>

        <State
          host={host}
          error={hostError}
          where={where}
          measured={measured}
        />

        <div className="t-field">
          <label className="t-field__label" htmlFor="wanl-area">
            {tx("ui.wiki-src-wiki.create-area")}{" "}
            <span className="t-field__hint">
              {tx("ui.wiki-src-wiki.create-top-folder-not-headers")}
            </span>
          </label>
          <input
            id="wanl-area"
            className="t-input t-mono"
            value={area}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setArea(event.target.value)}
          />
          {/*
           * The answer that sets this surface apart from a friendlier one —
           * and the only sentence on screen that announces something instead
           * of labeling something. It stays because it names a **state** the
           * reader is about to see: the area stays undeclared, because no
           * `wiki.yaml` is written here.
           *
           * Why none is written sits here and not there: a declaration with
           * an area nobody has decided to declare would be a statement
           * nobody made — exactly the invented value this project removes
           * everywhere (the specification). This is the justification for a design
           * decision, not information about this wiki.
           */}
          <p className="t-field__hint" data-testid="wiki-area-hint">
            {richText(
              "ui.wiki-src-wiki.create-stays-undeclared-until-somebody-enters-file",
              {
                undeclared: tx("ui.wiki-src-wiki.create-undeclared-area"),
                file: "wiki.yaml",
              },
              { undeclared: "b", file: "mono" },
            )}
          </p>
        </div>

        <div className="t-field">
          <label className="t-field__label" htmlFor="wanl-title">
            {tx("ui.wiki-src-wiki.create-title")}{" "}
            <span className="t-field__hint">
              {tx("ui.wiki-src-wiki.create-required-only-thing")}
            </span>
          </label>
          <input
            id="wanl-title"
            className="t-input wiki-create__title"
            value={title}
            placeholder={tx("ui.wiki-src-wiki.create-first-day")}
            autoComplete="off"
            onChange={(event) => setTitle(event.target.value)}
          />
          {/*
           * Four pieces of information about the file about to be created:
           * path, address, and the two front-matter fields it gets. Why it
           * gets no `reviewed` is stated in this file's header comment —
           * here it just states that it gets none.
           */}
          <p className="t-field__hint">
            {richText(
              "ui.wiki-src-wiki.create-file-address-address-status-no-reviewed",
              {
                file: `${where}/${path}`,
                address: `wiki:${path.replace(/\.md$/, "")}`,
                status: "status: draft",
                reviewed: "reviewed",
              },
              {
                file: "mono",
                address: "mono",
                status: "mono",
                reviewed: "mono",
              },
            )}
          </p>
        </div>

        <footer className="wiki-create__foot">
          {/*
           * The equivalent command stays visible. Whoever
           * scripts this must be able to see what the button did — and
           * where something keeps blocking, the one reason stands in the
           * same place.
           */}
          <p className="wiki-create__cmd t-mono">
            {problem ? (
              <span className="t-bad">{problem}</span>
            ) : (
              <>
                {richText(
                  "ui.wiki-src-wiki.create-corresponds-command",
                  { command },
                  { command: "b" },
                )}
              </>
            )}
          </p>
          <div className="wiki-create__actions">
            <button
              type="button"
              className="t-btn"
              onClick={onCancel}
              disabled={running !== null}
            >
              {tx("ui.wiki-src-wiki.create-cancel")}
            </button>
            <button
              type="button"
              className="t-btn t-btn--primary"
              data-testid="wiki-create-page"
              onClick={run}
              disabled={problem !== null || running !== null}
            >
              {/*
               * The label says what the click does — and that is two
               * different things. "propose as a branch" would, without
               * versioning, be a promise this run does not keep: no branch
               * is created, nothing is proposed, the file just sits there.
               */}
              {running
                ? runningLabel(running, withoutGit)
                : withoutGit
                  ? tx("ui.wiki-src-wiki.create-create-without-git-versioning")
                  : tx("ui.wiki-src-wiki.create-create-propose-branch")}
            </button>
          </div>
        </footer>
      </div>
    </article>
  );
}

type Finding = {
  label: string;
  /** What the host answered. Never empty: "unknown" is an answer. */
  value: string;
  /** What follows from it, in one line. Absent when nothing follows. */
  note?: string;
};

function State({
  host,
  error,
  where,
  measured,
}: {
  host: RepoState | null;
  error: string | null;
  where: string;
  /** Whether the location was really measured — otherwise it is not asserted. */
  measured: boolean;
}) {
  if (error) {
    return (
      <p className="wiki-create__state t-mono t-bad">
        {tx("ui.wiki-src-wiki.create-host-could-not-asked-error", { error })}
      </p>
    );
  }
  if (!host)
    return (
      <p className="wiki-create__state t-mono">
        {tx("ui.wiki-src-wiki.create-asking-host")}
      </p>
    );
  if (host.gitError)
    return (
      <p data-testid="wanl-state" className="wiki-create__state t-mono t-bad">
        {host.gitError}
      </p>
    );
  if (host.initialization)
    return (
      <p data-testid="wanl-state" className="wiki-create__state t-mono">
        {tx("ui.wiki-src-wiki.create-wiki-sub-repository-not-initialised")}{" "}
        <code>{host.initialization.command}</code>
      </p>
    );

  const findings: Finding[] = [];
  if (!host.repository) {
    // No branch, no remote, no forge: outside a repository there is nothing
    // to measure, so no pair about them stands here either.
    //

    findings.push({
      label: "git",
      value: tx("ui.wiki-src-wiki.create-no-repository"),
      note: tx(
        "ui.wiki-src-wiki.create-written-anyway-straight-into-folder-no",
      ),
    });
  } else {
    findings.push({
      label: tx("ui.wiki-src-wiki.create-branch"),
      value: host.branch || tx("ui.wiki-src-wiki.create-unknown"),
    });
    if (host.ignored) {
      findings.push({
        label: tx("ui.wiki-src-wiki.create-directory"),
        value: tx("ui.wiki-src-wiki.create-ignored-git"),
        note: tx(
          "ui.wiki-src-wiki.create-commit-does-not-reach-written-straight",
        ),
      });
    }
    if (!host.remote) {
      findings.push({
        label: "Remote",
        value: tx("ui.wiki-src-wiki.create-none"),
        // The consequence only applies when there is a branch. For an
        // ignored directory none is created, and "branch and commit are
        // created" would then be a promise this run does not keep — what
        // happens there instead sits under "Directory" and needs no second
        // version.
        note: host.ignored
          ? undefined
          : tx(
              "ui.wiki-src-wiki.create-branch-commit-created-nothing-pushed-pull",
            ),
      });
    } else {
      findings.push({ label: "Remote", value: host.remote });
      if (!host.forge) {
        //
        // A hostname does not reveal its forge: `git.example.org` is a GitLab
        // at one company and a Gitea at the next. The host therefore only
        // recognizes github.com and gitlab.com — those are addresses — and
        // never guesses for any other name. Writing that it is neither would
        // be a statement about a server nobody has ever visited; the reporter

        //
        // What is measured: for this host, nothing is explained. And the
        // consequence names the path forward, because a statement of fact
        // without a next step leaves the user unable to proceed.
        //

        // directory no branch is created, so no pull request either — and
        // "branch, commit and push run" would there simply be false. An
        // instruction to configure it would then be one that leads nowhere

        //
        // The **measured value** stays regardless. The remote is there, the
        // host is read, nothing is explained — that is measured and does not
        // stop being so because the consequence drops away. Omitting the
        // pair would mean nobody had asked.
        findings.push({
          label: "Git provider",
          value: tx("ui.wiki-src-wiki.create-not-explained"),
          note: host.ignored
            ? undefined
            : host.remoteHost
              ? tx(
                  "ui.wiki-src-wiki.create-branch-commit-push-run-pull-request",
                  {
                    host: host.remoteHost,
                    file: FACETRC,
                  },
                )
              : tx("ui.wiki-src-wiki.create-branch-commit-push-run-host-does"),
        });
      } else {
        // The origin sits with the value, and only when it is a declaration:
        // a recognized github.com the host has read from the remote, a
        // declared gitlab someone has written down. Printing both the same
        // way would mean asserting a measurement where a declaration stands.
        findings.push({
          label: "Git provider",
          value:
            host.forgeSource && host.forgeSource !== FORGE_FROM_REMOTE
              ? `${host.forge} · ${tx("ui.wiki-src-wiki.create-source", { source: host.forgeSource })}`
              : host.forge,
        });
        findings.push(
          host.tokenSource
            ? {
                label: "Token",
                value: tx("ui.wiki-src-wiki.create-source", {
                  source: host.tokenSource,
                }),
              }
            : {
                label: "Token",
                value: tx("ui.wiki-src-wiki.create-none-found"),
                // Only this forge's sources: `WikiTokenSource` reads, for
                // github, only GITHUB_TOKEN and gh, for gitlab only
                // GITLAB_TOKEN and glab. Naming all four would be half an
                // instruction that leads nowhere if followed.
                //
                // And no consequence at all when the directory is ignored:
                // then there is no pull request that could drop away, and
                // obtaining a token would not change that.
                note: host.ignored
                  ? undefined
                  : host.forge === "gitlab"
                    ? tx(
                        "ui.wiki-src-wiki.create-gitlab-token-glab-would-read-without",
                      )
                    : tx(
                        "ui.wiki-src-wiki.create-github-token-gh-would-read-without",
                      ),
              },
        );
      }
    }
    // Only the dirty tree gets a pair, and that is not an oversight: `dirty`
    // is a `bool` with no third state, and a failed `git status --porcelain`
    // leaves it `false`. "clean" would therefore sometimes mean "not
    // measured" here — exactly the claim this surface does not make. A
    // `true`, by contrast, is unambiguously measured.
    if (host.dirty) {
      findings.push({
        label: tx("ui.wiki-src-wiki.create-working-tree"),
        value: tx("ui.wiki-src-wiki.create-unsaved-changes"),
        // For an ignored directory no worktree is created, and the promise
        // "your working directory stays untouched" would simply be false:
        // the page lands exactly there. It therefore only stands where it
        // applies — and the other half, that git does not even look at the
        // file, already sits under "Directory".
        note: host.ignored
          ? undefined
          : tx(
              "ui.wiki-src-wiki.create-written-worktree-under-git-your-working",
            ),
      });
    }
  }
  // Only when measured. A location nobody has named does not belong in a
  // line whose entire purpose is to carry findings — and an absent pair
  // says that differently than a pair with "unknown".
  if (measured)
    findings.push({
      label: tx("ui.wiki-src-wiki.create-target"),
      value: where,
    });

  return (
    /*
     * A missing Git checkout affects versioning. Wiki pages can still be saved.
     */
    <dl
      className="wiki-create__state wiki-create__facts t-mono"
      data-testid="wanl-state"
    >
      {findings.map((b) => (
        <Fragment key={b.label}>
          <dt>{b.label}</dt>
          <dd>
            <span className="wiki-create__value" data-testid="wanl-value">
              {b.value}
            </span>
            {b.note ? (
              <span
                className="wiki-create__next"
                data-testid="wanl-consequence"
              >
                {b.note}
              </span>
            ) : null}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Result({
  result,
  where,
  onCancel,
}: {
  result: WikiCreated;
  where: string;
  onCancel: () => void;
}) {
  const wrote = result.done.includes("page");
  // Without versioning there is no branch to name and none to merge, and any
  // line below that named one would be a promise about something that does
  // not exist. That this is so is therefore stated explicitly here — not as
  // an absent line, but as its own.
  const withoutGit = result.unversioned === true;
  return (
    <article className="wiki-create">
      <div className="wiki-create__card">
        <p className="t-eyebrow">{tx("ui.wiki-src-wiki.create-create-wiki")}</p>
        <h1 className="t-h2">
          {result.failedAt
            ? tx("ui.wiki-src-wiki.create-aborted-way-what-stands-stands")
            : withoutGit
              ? tx("ui.wiki-src-wiki.create-created-without-git-versioning")
              : tx("ui.wiki-src-wiki.create-created-proposed-branch")}
        </h1>

        <div className="wiki-create__state t-mono">
          {withoutGit ? (
            <p>
              {tx(
                "ui.wiki-src-wiki.create-without-git-versioning-no-branch-no",
              )}
            </p>
          ) : (
            <p>
              {tx("ui.wiki-src-wiki.create-branch-branch", {
                branch: result.branch,
              })}
            </p>
          )}
          {wrote ? (
            <p>{`${where}/${result.path} · ${result.address}`}</p>
          ) : null}
          {result.sha ? (
            <p>
              {tx("ui.wiki-src-wiki.create-commit-sha", {
                sha: result.sha.slice(0, 8),
              })}
            </p>
          ) : null}
          {result.error && result.failedAt !== "pr" && result.worktree ? (
            <p>
              {tx("ui.wiki-src-wiki.create-worktree-path", {
                path: result.worktree,
              })}
            </p>
          ) : null}
          {result.url ? (
            <p>
              <a href={result.url} target="_blank" rel="noreferrer">
                {result.url}
              </a>
            </p>
          ) : null}
          {/*
           * The host's message as a sentence, not as a raw body. This used
           * to show the entire JSON blob of a 502 response — including the
           * two follow-up commands buried in quotes. The host answers
           * with 200 and named fields, and those are read individually.
           */}
          {result.note ? <p>{result.note.trim()}</p> : null}
        </div>

        {result.hint ? (
          // The hint names the next action. It stands as prose beside the
          // findings and not between them: the lines above say what is; this
          // one says what someone can do.
          <p className="wiki-create__lead">{result.hint}</p>
        ) : null}

        {result.error ? (
          <p className="wiki-create__lead">
            {richText(
              "ui.wiki-src-wiki.create-step-step-error-nothing-was-rolled",
              { step: result.failedAt ?? "", error: result.error },
              { step: "mono" },
            )}
          </p>
        ) : withoutGit ? (
          <p className="wiki-create__lead">
            {richText(
              "ui.wiki-src-wiki.create-page-lies-working-directory-nothing-no",
              {
                nothing: tx("ui.wiki-src-wiki.create-nothing-holds-place"),
                undeclared: tx("ui.wiki-src-wiki.create-not-declared"),
                file: "wiki.yaml",
              },
              { nothing: "b", undeclared: "b", file: "mono" },
            )}
          </p>
        ) : (
          <p className="wiki-create__lead">
            {richText(
              "ui.wiki-src-wiki.create-your-working-directory-was-not-touched",
              {
                git: ".git/",
                undeclared: tx("ui.wiki-src-wiki.create-not-declared"),
                file: "wiki.yaml",
              },
              { git: "mono", undeclared: "b", file: "mono" },
            )}
          </p>
        )}

        <footer className="wiki-create__foot">
          <p className="wiki-create__cmd t-mono">
            {withoutGit
              ? tx(
                  "ui.wiki-src-wiki.create-page-becomes-visible-here-once-corpus",
                )
              : tx(
                  "ui.wiki-src-wiki.create-page-becomes-visible-here-once-branch",
                )}
          </p>
          <div className="wiki-create__actions">
            <button
              type="button"
              className="t-btn t-btn--primary"
              onClick={onCancel}
            >
              {tx("ui.wiki-src-wiki.create-back")}
            </button>
          </div>
        </footer>
      </div>
    </article>
  );
}

/**
 * Where the front matter is built — and why not here.
 *
 * Pages are assembled without a local `pageSource()` helper; the output is
 * `---\ntitle: ${title}\n…`. The helper is intentionally absent, and that is the
 * real fix to this surface.
 *
 * It was a **second** implementation of a rule the host already has.
 * `wikiScalar` in `wiki_write.go` introduces quoting exactly where a bare
 * spelling would change meaning — colon, hash sign, quote mark, bracket, and
 * the reserved words `true`/`no`/`null`. A title "Onboarding: Tag 1" produced
 * a front-matter line here that `yaml.Unmarshal` rejects; "What is #facet?"
 * one that silently became "What is"; "true" a boolean value.
 *
 * So this surface sends fields (`front:`), and the host renders them with the
 * same function `facet wiki new` uses to render them. One rule, one place,
 * one test.
 */
