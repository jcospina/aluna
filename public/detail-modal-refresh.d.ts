export type RefreshRegion = { innerHTML: string };

export declare function refreshCommittedRecords<T extends RefreshRegion>(input: {
  region: T;
  readUrl: string;
  request?: (input: string, init?: RequestInit) => Promise<Response>;
  process?: (region: T) => void;
}): Promise<T>;
