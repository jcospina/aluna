export interface RecordsRegionRequestClaim {
  readonly signal: AbortSignal;
  abort(): void;
  isCurrent(): boolean;
  release(): void;
}

export interface RecordsRegionRequestCoordinator {
  claim(): RecordsRegionRequestClaim;
}

export function createRecordsRegionRequestCoordinator(): RecordsRegionRequestCoordinator;
export function recordsRegionRequestCoordinator(region: Element): RecordsRegionRequestCoordinator;
export function handOffRecordsRegionFromHtmx(
  region: Element,
  htmx: { trigger(node: Element, eventName: string): void } | undefined,
): void;
