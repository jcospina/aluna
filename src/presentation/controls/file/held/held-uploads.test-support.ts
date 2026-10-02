// The upload request the product transfer opens, as a double a case answers by hand. Not a test
// file itself, so bun never runs it.

/** One upload request: the route's admission is `admit`, and `aborted` says the page stopped it. */
export class UploadDouble {
  aborted = false;
  status = 0;
  responseText = "";
  private readonly listeners = new Map<string, (() => void)[]>();
  readonly upload = { addEventListener: () => {} };

  addEventListener(type: string, run: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), run]);
  }
  open(): void {}
  setRequestHeader(): void {}
  send(): void {}
  abort(): void {
    this.aborted = true;
    this.fire("abort");
  }
  /** The route admits the file under `key`. */
  admit(key: string, name: string): void {
    this.status = 201;
    this.responseText = JSON.stringify({ key, url: `/files/${key}`, name, size: 10 });
    this.fire("load");
  }
  private fire(type: string): void {
    for (const run of this.listeners.get(type) ?? []) run();
  }
}
