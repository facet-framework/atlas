export type WikiSource = {
  /** Measured unavailable Git checkout, including the host-generated local remedy. */
  initialization?: { path: string; command: string };
  /** Failure to read an existing Git marker, distinct from an absent checkout. */
  gitError?: string;
  /** Where the wiki lives, relative to the root — so a surface can name the file. */
  dir: string;
  /** `wiki.yaml` verbatim; absent when the project writes none. */
  config?: string;
  /** Path under `wiki/` → raw file content. */
  pages: Record<string, string>;
  /** Path → address. The one derived quantity that belongs to the host. */
  addresses: Record<string, string>;
  /**
   * Whether nothing holds these pages down: no git repository, or a
   * directory git is told to ignore.
   *
   * Measured by the host (`git check-ignore`), not recomputed by the reader —
   * what `.gitignore` means is git's answer. Shipped with the corpus instead
   * of asked for on demand, because the promise is that the reader says it
   * **durably**: a wiki that looks versioned and is not is the worse state
   * independently of whether any pages exist.
   */
  unversioned?: boolean;
};
