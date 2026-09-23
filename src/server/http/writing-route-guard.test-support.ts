// Bodies for probing a writing-route guard: produced only as they are read, so a test can say
// whether a refusal read anything, and how far a count got before it stopped.

const CHUNK_BYTES = 64 * 1024;
const FILL = "a".charCodeAt(0);

export interface ProbeBody {
  readonly stream: ReadableStream<Uint8Array>;
  /** How many bytes the reader has pulled so far. */
  readonly pulledBytes: () => number;
  readonly cancelled: () => boolean;
}

/**
 * `total` bytes (Infinity for a body that never ends) beginning with `head` and filled with `a`,
 * so `head` = `"x="` makes a urlencoded form. Nothing is produced before the first read.
 */
export function probeBody(total: number, head = ""): ProbeBody {
  const opening = new TextEncoder().encode(head);
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled >= total) {
          controller.close();
          return;
        }
        const size = Math.min(CHUNK_BYTES, total - pulled);
        const chunk = new Uint8Array(size).fill(FILL);
        chunk.set(opening.subarray(pulled, pulled + size));
        pulled += size;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulledBytes: () => pulled, cancelled: () => cancelled };
}

/**
 * A request init streaming `body` with no declared length, the way a chunked upload arrives.
 * `duplex` is not in the DOM lib's `RequestInit`, so the init is widened rather than suppressed.
 */
export function streamedInit(
  method: string,
  body: ProbeBody,
  headers: Record<string, string> = {},
): RequestInit {
  return { method, headers, body: body.stream, duplex: "half" } as RequestInit;
}
