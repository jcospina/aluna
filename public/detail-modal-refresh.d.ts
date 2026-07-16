export type RefreshRegion = { innerHTML: string };

export declare const RECORDS_REFRESH_START_EVENT: string;

export declare function committedRecordsRefreshTarget(input: {
  readUrl: string;
  searchUrl?: string;
  activeQuery?: string;
}): { url: string; query: string };

export declare function refreshCommittedRecords<T extends RefreshRegion>(input: {
  region: T;
  readUrl: string;
  searchUrl?: string;
  activeQuery?: string;
  request?: (input: string, init?: RequestInit) => Promise<Response>;
  process?: (region: T) => void;
  claimRequest?: () => import("./records-region-requests.js").RecordsRegionRequestClaim;
}): Promise<{ applied: boolean; region: T; query: string }>;

export declare function refreshCommittedRecordsForMutation(input: {
  form: HTMLFormElement;
  request?: (input: string, init?: RequestInit) => Promise<Response>;
  process?: (region: HTMLElement) => void;
}): Promise<{ applied: boolean; region: HTMLElement; query: string } | null>;
