/**
 * The travel axis: what may move a thing across the surface, and what may not.
 *
 * Motion is on by default for everyone. When the OS Reduce Motion setting is on, Aluna
 * stops travel — a window arriving from somewhere else, content sliding, a press jumping
 * — because travel is what makes a reader ill. In-place life carries on: a mark grows into
 * its box, a chevron turns over, the working tile crawls, the pet breathes. Standing
 * perfectly still is not an accessible surface, it is a dead one (PLAN decision 44).
 *
 * The promise is kept by a shape rather than by a list of components:
 *
 *   - `transform` says where a thing sits. `translate` is how far it travels. `scale` and
 *     `rotate` are how it changes without going anywhere.
 *   - Travel states its distance and its duration through `--travel`, which one media
 *     query in the token layer takes to zero. Distance times zero does not move; duration
 *     times zero lands rather than sliding, which is how a row displaced from JavaScript
 *     is reached.
 *   - Life keeps a duration of its own and is never allowed onto the travel duration, so
 *     quieting travel cannot quietly flatten it.
 *
 * This module states those rules over stylesheet text rather than over files, so the same
 * rules can be run against the shipped surface and against a rule written to break them —
 * which is how `travel-axis.test.ts` shows the check has teeth rather than only that the
 * surface currently passes.
 */

/** A stylesheet to check, named for the message a violation carries. */
export interface Sheet {
  readonly name: string;
  readonly css: string;
}

/** A script to check, named the same way. */
export interface Script {
  readonly name: string;
  readonly source: string;
}

/** The sheet that owns the axis. Every travelling distance is declared here. */
export const AXIS_SHEET = "design/styles/tokens.css";

/** The whole of Reduce Motion, as the token layer is required to state it. */
export const AXIS_RULE = ":root { --travel: 0; }";

/**
 * The properties that move a box or push the content around it. A transition on one of
 * these travels, whatever it is attached to, so it answers to the travel duration.
 * `scale` and `rotate` are deliberately absent: they change a thing where it stands.
 */
const GEOMETRY = [
  "translate",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "margin",
  "padding",
  "width",
  "height",
  "gap",
  "row-gap",
  "column-gap",
  "flex-basis",
];

/** The two properties whose whole job is to displace. Their distances must be on the axis. */
const DISPLACING = ["translate", "transform"];

/** A property that moves something, including the longhands of the shorthands above. */
const geometric = (property: string): boolean =>
  GEOMETRY.some((name) => property === name || property.startsWith(`${name}-`));

/**
 * A selector that matches only some of the time: a state, or a step of a keyframe. A
 * displacement under one of these is travel — the thing was somewhere else a moment ago. A
 * displacement under a plain selector is placement: where the element is drawn, always.
 *
 * The list is a heuristic and is allowed to be, because a selector it misses does not fall
 * through to nothing: an unrecognised state still has to state its distance as a token
 * from the axis sheet, which is a line somebody has to add where it will be read.
 */
const STATE =
  /:hover|:active|:focus|:checked|:disabled|:indeterminate|:target|:open|:valid|:invalid|:placeholder-shown|:popover-open|:has\(|:not\(|\[data-|\[aria-|\[open|\[hidden|\.is-|\.has-/;
const STEP = /^(?:from|to|[\d.]+%)(?:\s*,\s*(?:from|to|[\d.]+%))*$/;

const isStep = (selector: string): boolean => STEP.test(selector);
const changes = (selector: string): boolean => STATE.test(selector) || isStep(selector);

/** A rule's selector and its body, with `@media` wrappers stepped over. */
function bodies(css: string): { selector: string; body: string }[] {
  return css.split("}").flatMap((chunk) => {
    if (!chunk.includes("{")) return [];
    const cut = chunk.lastIndexOf("{");
    const selector = (chunk.slice(0, cut).split(/[{}]/).pop() ?? "").replace(/\s+/g, " ").trim();
    return [{ selector, body: chunk.slice(cut + 1) }];
  });
}

interface Declaration {
  readonly sheet: string;
  readonly selector: string;
  readonly property: string;
  readonly value: string;
}

/** Every declaration in a sheet. Comments are expected to be stripped already. */
function declarationsIn({ name, css }: Sheet): Declaration[] {
  return bodies(css).flatMap(({ selector, body }) =>
    [...body.matchAll(/(?:^|[;\s])(--[\w-]+|[a-z][a-z-]*)\s*:\s*([^;]+)/gi)].map(
      ([, property, value]) => ({
        sheet: name,
        selector,
        property: (property as string).toLowerCase(),
        value: (value as string).trim(),
      }),
    ),
  );
}

const site = ({ sheet, selector, property }: Declaration): string =>
  `${sheet} § ${selector} [${property}]`;

/** Split a value on its own separators, not on the ones inside `var()` or `calc()`. */
function split(value: string, on: RegExp): string[] {
  const found: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && on.test(character)) {
      found.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  found.push(current.trim());
  return found.filter((part) => part.length > 0);
}

/** Every length in a value that is not zero, once tokens and percentages are set aside. */
function rawLengths(value: string): string[] {
  const bare = value.replace(/var\([^)]*\)/g, " ").replace(/-?[\d.]+%/g, " ");
  return [...bare.matchAll(/-?\d*\.?\d+[a-z]+/gi)]
    .map(([length]) => length)
    .filter((length) => Number.parseFloat(length) !== 0);
}

/**
 * What a declaration displaces by. A `transform` displaces by its translations and by
 * nothing else — a scale or a rotation in there stays where it is. Every other property
 * that displaces states the distance itself, one component per axis.
 */
function displacements({ property, value }: Declaration): string[] {
  if (property !== "transform") return split(value, /\s/);
  return [...value.matchAll(/\btranslate(?:3d|X|Y|Z)?\(([^)]*)\)/g)].flatMap(([, argument]) =>
    split(argument as string, /,/),
  );
}

/** Nothing at all: an absent transform, or a zero distance with or without a unit. */
const isStill = (component: string): boolean => /^(?:none|-?0[a-z%]*)$/.test(component);

/** The custom properties a value reaches for. */
const tokensIn = (value: string): string[] =>
  [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map(([, name]) => name as string);

/**
 * Everything on the surface that could move without answering to the axis.
 *
 * Every rule reports rather than throws, so one run says all of what is wrong instead of
 * the first thing it met.
 */
export function travelViolations(sheets: readonly Sheet[]): string[] {
  const all = sheets.flatMap((sheet) => declarationsIn(sheet));
  return [
    ...sheets.flatMap(preferenceAnsweredOnce),
    ...axisOwnsItsTokens(all),
    ...distancesOnTheAxis(all),
    ...durationsOnTheAxis(all),
    ...lifeStaysWhereItIs(all),
  ].filter((message) => message.length > 0);
}

/** How the token layer is required to state the whole of Reduce Motion. */
function axisStatesTheWholeOfIt(css: string): string[] {
  const blocks = [
    ...css.matchAll(/@media[^{]*prefers-reduced-motion[^{]*\{((?:[^{}]|\{[^{}]*\})*)\}/g),
  ];
  const mentions = (css.match(/prefers-reduced-motion/g) ?? []).length;
  if (mentions !== 1 || blocks.length !== 1) {
    return [`${AXIS_SHEET} states Reduce Motion ${mentions} times, and it is one declaration`];
  }
  if (!/\(\s*prefers-reduced-motion:\s*reduce\s*\)/.test(css)) {
    return [`${AXIS_SHEET} asks the preference in a form that is not \`reduce\``];
  }
  const body = (blocks[0]?.[1] ?? "").replace(/\s+/g, " ").trim();
  return body === AXIS_RULE
    ? []
    : [`${AXIS_SHEET} does more under Reduce Motion than turn travel off: \`${body}\``];
}

/** Reduce Motion is answered once, in the token layer, and nowhere else. */
function preferenceAnsweredOnce({ name, css }: Sheet): string[] {
  if (name === AXIS_SHEET) return axisStatesTheWholeOfIt(css);
  return css.includes("prefers-reduced-motion")
    ? [
        `${name} answers Reduce Motion itself — the axis in ${AXIS_SHEET} is the one answer, and a second one drifts from it`,
      ]
    : [];
}

/** Every distance on the axis is declared in the token layer, and consumes the scale. */
function axisOwnsItsTokens(all: readonly Declaration[]): string[] {
  const found: string[] = [];
  for (const rule of all) {
    const { property, value, sheet } = rule;
    if (!/^--(?:travel|dur-travel)/.test(property)) continue;
    if (sheet !== AXIS_SHEET) {
      found.push(`${site(rule)} declares a travel token outside ${AXIS_SHEET}`);
      continue;
    }
    if (property === "--travel") continue;
    if (!value.includes("var(--travel)")) {
      found.push(`${site(rule)} does not consume the axis, so Reduce Motion cannot reach it`);
    }
  }
  return found;
}

/** What a displacement's component may be, in the two cases it is read in. */
function componentViolation(rule: Declaration, component: string, defined: Set<string>): string {
  if (isStill(component)) return "";
  if (rawLengths(component).length > 0) {
    return `${site(rule)} displaces by \`${component}\`, a distance no Reduce Motion setting can reach`;
  }
  if (changes(rule.selector)) {
    return component.includes("var(--travel-")
      ? ""
      : `${site(rule)} moves by \`${component}\`, which is not on the travel axis`;
  }
  const strayed = tokensIn(component).filter((name) => defined.has(name));
  return strayed.length > 0
    ? `${site(rule)} is placed by \`${strayed.join(", ")}\`, a distance declared outside ${AXIS_SHEET}`
    : "";
}

/** No displacement anywhere states a distance the axis cannot reach. */
function distancesOnTheAxis(all: readonly Declaration[]): string[] {
  // A custom property declared outside the token layer: a distance laundered through a
  // name of its own is the oldest way around a token.
  const defined = new Set(
    all
      .filter((rule) => rule.property.startsWith("--") && rule.sheet !== AXIS_SHEET)
      .map((rule) => rule.property),
  );
  const moving = all.filter(
    (rule) =>
      DISPLACING.includes(rule.property) || (isStep(rule.selector) && geometric(rule.property)),
  );
  return moving.flatMap((rule) =>
    displacements(rule)
      .map((component) => componentViolation(rule, component, defined))
      .filter((message) => message.length > 0),
  );
}

/** One layer of a `transition`: what it animates, and how long that takes. */
function layerViolation(rule: Declaration, layer: string): string {
  const words = layer.match(/[\w-]+\([^)]*\)|\S+/g) ?? [];
  const isTime = (word: string) => /^[\d.]+m?s$/.test(word) || /^var\(--dur-/.test(word);
  const isEasing = (word: string) =>
    /^(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(word) ||
    /^(?:cubic-bezier|steps|linear)\(/.test(word) ||
    /^var\(--ease-/.test(word);
  const property = words.find((word) => !isTime(word) && !isEasing(word)) ?? "";
  const duration = words.find(isTime);
  if (property === "transform" || property === "all") {
    return `${site(rule)} transitions \`${property}\`, which carries travel and life at once — travel goes on \`translate\`, life on \`scale\` or \`rotate\``;
  }
  if (geometric(property)) {
    return duration === "var(--dur-travel)"
      ? ""
      : `${site(rule)} animates \`${property}\` over \`${duration ?? "no duration"}\`, which Reduce Motion cannot turn off`;
  }
  return duration === "var(--dur-travel)"
    ? `${site(rule)} puts \`${property}\` on the travel duration, so quieting travel would flatten it`
    : "";
}

/** Every transition names one axis or the other, and takes that axis's duration. */
function durationsOnTheAxis(all: readonly Declaration[]): string[] {
  const found: string[] = [];
  for (const rule of all) {
    if (rule.property === "transition-property" || rule.property === "transition-duration") {
      found.push(`${site(rule)} states a transition in a longhand, out of reach of the rule here`);
    }
    if (rule.property !== "transition" || rule.value === "none") continue;
    found.push(...split(rule.value, /,/).map((layer) => layerViolation(rule, layer)));
  }
  return found.filter((message) => message.length > 0);
}

/**
 * The two things that would make `scale` and `rotate` travel after all: an origin outside
 * the box, which turns a turn into a sweep, and a `transform` inside a keyframe, which
 * carries both axes under one name.
 */
function lifeStaysWhereItIs(all: readonly Declaration[]): string[] {
  const found: string[] = [];
  for (const rule of all) {
    if (rule.property === "transform-origin") {
      found.push(
        `${site(rule)} moves the origin a scale or a rotation turns about — off centre, life becomes a sweep across the surface`,
      );
    }
    if (rule.property === "transform" && isStep(rule.selector)) {
      found.push(
        `${site(rule)} animates \`transform\`, which carries travel and life at once — use \`translate\`, \`scale\` or \`rotate\``,
      );
    }
  }
  return found;
}

/* ── What a script may do ─────────────────────────────────────────────────── */

/** The keys of an animation frame that put an element somewhere else. */
const FRAME_KEYS =
  /(?:^|[{,\s])["']?(transform|translate|left|top|right|bottom|inset|margin[A-Za-z]*)["']?\s*:\s*([^,}]+)/g;

/** The frames of an `.animate()` call, or nothing if they are not written where they are read. */
function framesOf(source: string, from: number): string | null {
  const opened = source.indexOf("[", from);
  if (opened === -1 || source.slice(from, opened).trim().length > 0) return null;
  let depth = 0;
  for (let at = opened; at < source.length; at += 1) {
    if (source[at] === "[") depth += 1;
    if (source[at] === "]") depth -= 1;
    if (depth === 0) return source.slice(opened, at + 1);
  }
  return null;
}

/** One `.animate()` call: it must state its frames here, and it must not move anything. */
function animationViolation(name: string, frames: string | null): string {
  if (frames === null) {
    return `${name} animates from frames written somewhere this cannot read them — state them inline, so what moves can be seen`;
  }
  const moved = new Map<string, Set<string>>();
  for (const [, key, value] of frames.matchAll(FRAME_KEYS)) {
    const seen = moved.get(key as string) ?? new Set<string>();
    seen.add((value as string).trim());
    moved.set(key as string, seen);
  }
  const single = (frames.match(/\{/g) ?? []).length < 2;
  for (const [key, values] of moved) {
    if (values.size > 1 || single) {
      return `${name} animates \`${key}\`, and travel a script writes is travel the axis cannot quiet`;
    }
  }
  return "";
}

/** Everything a script could do that the stylesheets' axis would never see. */
function scriptViolation({ name, source }: Script): string[] {
  const found: string[] = [];
  if (source.includes("prefers-reduced-motion")) {
    found.push(
      `${name} asks the OS about motion — the axis is the one answer, and \`--travel\` is already zero or one`,
    );
  }
  if (
    /\.style\.(?:transition|animation)\s*=|setProperty\(\s*["'](?:transition|animation)/.test(
      source,
    )
  ) {
    found.push(`${name} writes a transition from a script, where no stylesheet check can read it`);
  }
  for (const { index } of source.matchAll(/\.animate\(/g)) {
    found.push(animationViolation(name, framesOf(source, (index ?? 0) + ".animate(".length)));
  }
  return found.filter((message) => message.length > 0);
}

/** Everything a script could do that the stylesheets' axis would never see. */
export function scriptViolations(scripts: readonly Script[]): string[] {
  return scripts.flatMap(scriptViolation);
}
