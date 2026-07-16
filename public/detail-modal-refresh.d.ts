export type RefreshRegion = { innerHTML: string };

export declare const RECORDS_REFRESH_START_EVENT: string;

export type MutationKind = "create" | "update" | "delete";

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
}): Promise<{ region: T; query: string }>;

export declare function refreshCommittedRecordsForMutation(input: {
  form: HTMLFormElement;
  request?: (input: string, init?: RequestInit) => Promise<Response>;
  process?: (region: HTMLElement) => void;
}): Promise<{ region: HTMLElement; query: string } | null>;
