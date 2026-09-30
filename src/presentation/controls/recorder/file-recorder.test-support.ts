// A browser's media for the voice recorder (`design/scripts/files/file-recorder.js`), standing in for
// a microphone: every call the recorder makes is kept, every track says whether it was stopped,
// and the clock and the timers move only when a test moves them.

import type { RecorderEnv } from "#design/files/recorder-env.js";

export class Track extends EventTarget {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

/** A recorder whose chunks the test hands it, as the browser would every second. */
export class Recording extends EventTarget {
  static types: readonly string[] = ["audio/webm;codecs=opus", "audio/webm"];
  static made: Recording[] = [];
  static isTypeSupported = (type: string) => Recording.types.includes(type);
  state: "inactive" | "recording" = "inactive";
  timeslice = 0;
  constructor(
    readonly stream: unknown,
    readonly options: { mimeType?: string } = {},
  ) {
    super();
    Recording.made.push(this);
  }
  get mimeType(): string {
    return this.options.mimeType ?? "";
  }
  start(timeslice: number): void {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  /** Hand the recorder a chunk, as `dataavailable` does. */
  emit(bytes: Uint8Array): void {
    const event = Object.assign(new Event("dataavailable"), { data: new Blob([bytes]) });
    this.dispatchEvent(event);
  }
  stop(): void {
    this.state = "inactive";
    queueMicrotask(() => this.dispatchEvent(new Event("stop")));
  }
}

type Options = {
  refuse?: string;
  /** The browser never answers, as it doesn't while its prompt is open. */
  waits?: boolean;
};

/**
 * The media a test drives the recorder with. `tick` moves the clock and runs every timer once;
 * `hide` says the field left the screen; `answer` lets a waiting browser say yes.
 */
export function standInMedia(options: Options = {}) {
  const tracks: Track[] = [];
  const guards: boolean[] = [];
  const timers = new Set<{ run: () => void; ms: number; due: number }>();
  const waiting: (() => void)[] = [];
  let asked = 0;
  let hidden: (() => void) | null = null;
  let now = 0;
  Recording.made = [];
  const stream = () => {
    const track = new Track();
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  const env = {
    mediaDevices: {
      getUserMedia: async () => {
        asked += 1;
        if (options.refuse) throw new DOMException("refused", options.refuse);
        if (options.waits) return new Promise((resolve) => waiting.push(() => resolve(stream())));
        return stream();
      },
    },
    MediaRecorder: Recording,
    AudioContext: class {
      createAnalyser() {
        return {
          fftSize: 64,
          getByteTimeDomainData: (samples: Uint8Array) =>
            samples.forEach((_, i) => {
              samples[i] = 128 + ((now / 50) % 7) * 10 * (i % 2 === 0 ? 1 : -1);
            }),
        };
      }
      createMediaStreamSource() {
        return { connect() {} };
      }
      async close() {}
    },
    agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:156.0) Gecko/20100101 Firefox/156.0",
    touchPoints: 0,
    now: () => now,
    date: () => new Date(2026, 8, 29, 14, 5, 23),
    repeat: (run: () => void, ms: number) => {
      const timer = { run, ms, due: now + ms };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    guardLeave: (_holder: object, on: boolean) => guards.push(on),
    watchShown: (_el: unknown, whenHidden: () => void) => {
      hidden = whenHidden;
      return () => {
        hidden = null;
      };
    },
  };
  return {
    env: env as unknown as RecorderEnv,
    tracks,
    guards,
    get asked() {
      return asked;
    },
    get recorder(): Recording | undefined {
      return Recording.made.at(-1);
    },
    /** Move the clock on, running each timer that falls due, once. */
    tick(ms: number) {
      now += ms;
      for (const timer of [...timers]) {
        if (timer.due > now || !timers.has(timer)) continue;
        timer.due = now + timer.ms;
        timer.run();
      }
    },
    hide() {
      hidden?.();
    },
    async answer() {
      for (const resolve of waiting.splice(0)) resolve();
      await settle();
    },
  };
}

/** Let every promise the recorder is waiting on settle. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 20; round++) await new Promise((resolve) => setTimeout(resolve, 0));
}
