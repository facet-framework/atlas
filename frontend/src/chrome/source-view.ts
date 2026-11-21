/** The named source view a corpus was resolved through, as the host sends it. */
export type SourceViewSummary = {
  name: string;
  registryRepository?: string;
  registryRevision?: string;
  recordContentHash: string;
  sources: { repository: string; revision: string; contentHash: string; dirty: boolean }[];
};
