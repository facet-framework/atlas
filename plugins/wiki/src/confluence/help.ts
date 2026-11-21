/**
 * @facet: customization/documents/wiki-plugin
 * @facet-role: related
 */

import { tx } from "../../../../frontend/src/i18n";

/**
 * Title and sentence. The title is bold, the sentence is the sentence.
 * A function, not a constant: the texts are read when the help opens, so a
 * language change reaches them.
 */
export function help(): [string, string][] {
  return [
    [
      tx("ui.wiki-src-confluence.help-two-trees"),
      tx(
        "ui.wiki-src-confluence.help-wiki-repository-left-confluence-right-existing",
      ),
    ],
    [
      tx("ui.wiki-src-confluence.help-mapping-dragging"),
      tx("ui.wiki-src-confluence.help-tick-several-areas-left-drag-bundle"),
    ],
    [
      tx("ui.wiki-src-confluence.help-origin-copy"),
      tx("ui.wiki-src-confluence.help-origin-side-wins-copy-drawn-dashed"),
    ],
    [
      tx("ui.wiki-src-confluence.help-proposal-not-merge"),
      tx(
        "ui.wiki-src-confluence.help-changes-arrive-other-side-proposal-branch",
      ),
    ],
    [
      tx("ui.wiki-src-confluence.help-one-area-one-connection"),
      tx(
        "ui.wiki-src-confluence.help-area-imported-mirrored-never-both-mirror",
      ),
    ],
    [
      tx("ui.wiki-src-confluence.help-access"),
      tx(
        "ui.wiki-src-confluence.help-host-reads-confluence-url-confluence-email",
      ),
    ],
    [
      tx("ui.wiki-src-confluence.help-run-not-here"),
      tx("ui.wiki-src-confluence.help-import-facet-wiki-import-confluence-ref"),
    ],
    [
      tx("ui.wiki-src-confluence.help-after-first-import"),
      tx("ui.wiki-src-confluence.help-atlas-asks-question-nobody-should-skip"),
    ],
  ];
}
