import type { ZodType } from "zod";

import type { DeepPartial, GenerateResult, Provider } from "./contract.ts";

export class ProviderAbortedError extends Error {
  override readonly name = "ProviderAbortedError";
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new ProviderAbortedError("Provider generation was aborted.");
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
