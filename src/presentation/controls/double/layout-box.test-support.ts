// What a laid-out element reports, as a base the DOM double's element stands on. The double has no
// layout engine, so every measurement is a number a fixture sets, and the few rules a browser
// applies to them — a scroller clamps, content is floored at the given height — are kept here.

export class LaidOut {
  /** What `place()` measures. Fixed: what it decides is above-or-below, not a pixel. */
  offsetHeight = 36;
  private ownContentHeight = 200;
  scrollWidth = 200;

  /**
   * The height the content needs, floored at the box the element has been given, which is what a
   * browser reports. That floor is why a growing textarea measures itself at `height: auto`.
   */
  get scrollHeight(): number {
    const given = this.givenHeight();
    return Math.max(this.ownContentHeight, Number.isFinite(given) ? given : 0);
  }

  /** A fixture sets the content height; the floor above is the browser's, not its. */
  set scrollHeight(next: number) {
    this.ownContentHeight = next;
  }
  /**
   * The scrollport, the border box less its scrollbars — the distinction the reveal turns on.
   * Defaulted from `box` and settable by a fixture that wants a scrollbar.
   */
  clientTop = 0;
  clientLeft = 0;
  private ownClientHeight: number | null = null;
  private ownClientWidth: number | null = null;

  get clientHeight(): number {
    return this.ownClientHeight ?? this.box.bottom - this.box.top;
  }

  set clientHeight(next: number) {
    this.ownClientHeight = next;
  }

  get clientWidth(): number {
    return this.ownClientWidth ?? this.box.right - this.box.left;
  }

  set clientWidth(next: number) {
    this.ownClientWidth = next;
  }

  /**
   * What the reveal moves, clamped the way a real scroller clamps it. There is no
   * `scrollIntoView` here: the picker gave it up, because it scrolls every ancestor.
   */
  private ownScrollTop = 0;
  private ownScrollLeft = 0;

  get scrollTop(): number {
    return this.ownScrollTop;
  }

  set scrollTop(next: number) {
    const room = Math.max(this.scrollHeight - this.clientHeight, 0);
    this.ownScrollTop = Math.min(Math.max(next, 0), room);
  }

  get scrollLeft(): number {
    return this.ownScrollLeft;
  }

  set scrollLeft(next: number) {
    const room = Math.max(this.scrollWidth - this.clientWidth, 0);
    this.ownScrollLeft = Math.min(Math.max(next, 0), room);
  }

  /**
   * The box this element reports, and the few computed properties the placement walk asks about.
   * Both are settable by a fixture, since the walk's decisions depend entirely on them.
   */
  box: { top: number; bottom: number; left: number; right: number; width: number; height: number } =
    { top: 100, bottom: 136, left: 0, right: 200, width: 200, height: 36 };
  computed: {
    overflowX: string;
    overflowY: string;
    position: string;
    transform: string;
    translate: string;
    scale: string;
    rotate: string;
    filter?: string;
  } = {
    overflowX: "visible",
    overflowY: "visible",
    position: "static",
    // The four properties that make a containing block for a fixed panel. The surface states its
    // motion in the individual three, so a double carrying only `transform` would miss it.
    transform: "none",
    translate: "none",
    scale: "none",
    rotate: "none",
  };

  /** The height the element has been given, if any; the double's element reads its own style. */
  protected givenHeight(): number {
    return Number.NaN;
  }
}
