import type { ZodType } from "zod";

import type { DeepPartial, GenerateResult, Provider } from "./contract.ts";

export class ProviderAbortedError extends Error {
  override readonly name = "ProviderAbortedError";

  constructor(
    message = "Provider generation was aborted.",
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

function abortError(signal: AbortSignal): Error {
  if (
    signal.reason instanceof ProviderAbortedError ||
    (signal.reason instanceof Error && signal.reason.name === "AbortError")
  ) {
    return signal.reason;
  }
  return new ProviderAbortedError(
    signal.reason instanceof Error ? signal.reason.message : "Provider generation was aborted.",
    signal.reason,
  );
}

/** True only for the two abort shapes the provider wrapper deliberately emits. */
export function isProviderAbortError(error: unknown): error is Error {
  return (
    error instanceof ProviderAbortedError || (error instanceof Error && error.name === "AbortError")
  );
}

function rejectOnAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function* stopStreamOnAbort<T>(
  source: AsyncIterable<DeepPartial<T>>,
  signal: AbortSignal,
): AsyncGenerator<DeepPartial<T>> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await rejectOnAbort(iterator.next(), signal);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  }
}

/**
 * Make every awaited provider result cooperatively abortable without leaking the
 * concrete SDK cancellation surface through the provider contract. Late provider
 * completion cannot resume the build after the wrapper rejects.
 */
export function abortableProvider(provider: Provider, signal?: AbortSignal): Provider {
  if (!signal) return provider;

  return {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      // Do not start provider work after cancellation. `rejectOnAbort` protects awaited
      // handles, but checking only after `provider.generate` would still initiate a network
      // request that no build is allowed to publish.
      if (signal.aborted) throw abortError(signal);
      const result = provider.generate(prompt, schema);
      const object = rejectOnAbort(result.object, signal);
      const usage = rejectOnAbort(result.usage, signal);
      // Either handle may be unused after its sibling aborts. Observe both without
      // changing what their eventual awaiters receive.
      void object.catch(() => undefined);
      void usage.catch(() => undefined);
      return {
        partialStream: stopStreamOnAbort(result.partialStream, signal),
        object,
        usage,
      };
    },
  };
}
