export type CapabilitySearchState = "idle" | "loading" | "results" | "no-matches" | "error";

export declare const DEFAULT_SEARCH_DEBOUNCE_MS: number;

export declare function handOffRecordsRegionToSearch(
  region: Element,
  htmx: { trigger(node: Element, eventName: string): void } | undefined,
): void;

export declare function createDebouncedCapabilitySearch(options: {
  readUrl: string;
  searchUrl: string;
  render: (html: string) => void;
  state: (state: CapabilitySearchState) => void;
  queryChanged?: (rawQuery: string) => void;
  cancelExternalRead?: () => void;
  request?: (input: string, init?: RequestInit) => Promise<Response>;
  delayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}): {
  dispose(): void;
  searchNow(rawQuery: string): Promise<void>;
  update(rawQuery: string): void;
};
