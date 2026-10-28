// The facts a build reports about itself as it runs, each sent as one `progress` event
// (ADR-0002): which stage has started, whose house rules are being written, which part of the
// window is being made, remade, kept or checked, which check is under way, the names the plan
// settled on, and how long it all took.
// The window's narration turns them into the drawing, the stage dots and the lines it says.
// Nothing here is copy, so the voice lives in one place, beside the drawing that speaks it.

import type {
  BehavioralTestFreezeProgress,
  GateObserver,
  GateRungName,
  GeneratedUnit,
  UnitDescriptor,
  UnitGenerationObserver,
} from "../../builder/index.ts";
import { labelInSentence } from "../../presentation/controls/link/link-copy.ts";
import type { CapabilitySpec, CapabilityTool } from "../../registry/index.ts";
import type { Linked } from "../build/linking.ts";
import type { SendBuildEvent } from "../jobs/build-jobs.ts";

export const PROGRESS_EVENT = "progress";

export type NarrationStage =
  | "listen"
  | "plan"
  | "room"
  | "rules"
  | "make"
  | "connect"
  | "check"
  | "mend"
  | "finish";
export type NarrationPart = "card" | "add" | "open" | "change" | "remove" | "search";
export type NarrationPartState = "kept" | "making" | "mending" | "made" | "checked";
export type NarrationRulesState = "writing" | "written";
export type NarrationCheck = "fit" | "try" | "look" | "rules";

export type ProgressFact =
  | { readonly kind: "plan"; readonly stages: readonly NarrationStage[] }
  | { readonly kind: "stage"; readonly stage: NarrationStage }
  | { readonly kind: "opening"; readonly text: string }
  | {
      readonly kind: "shape";
      readonly label: string;
      readonly noun: string;
      readonly plural: string;
      readonly fields: readonly string[];
      readonly parts: readonly NarrationPart[];
    }
  | {
      readonly kind: "rules";
      readonly part: NarrationPart;
      readonly state: NarrationRulesState;
    }
  | {
      readonly kind: "part";
      readonly part: NarrationPart;
      readonly state: NarrationPartState;
    }
  | {
      readonly kind: "connect";
      readonly links: readonly { readonly field: string; readonly target: string }[];
    }
  | { readonly kind: "check"; readonly check: NarrationCheck }
  | { readonly kind: "finish"; readonly elapsedMs: number };

const PART_OF_UNIT: Readonly<Record<UnitDescriptor["name"], NarrationPart>> = {
  item: "card",
  create: "add",
  read: "open",
  update: "change",
  delete: "remove",
  search: "search",
};

const CHECK_OF_RUNG: Readonly<Record<GateRungName, NarrationCheck>> = {
  structural: "fit",
  smoke: "try",
  "design-lint": "look",
  behavioral: "rules",
};

/** The stages a build will pass through, in order, as the window's dots show them. */
export function plannedStages(options: {
  readonly rules: boolean;
  readonly connect: boolean;
}): readonly NarrationStage[] {
  return [
    "listen",
    "plan",
    "room",
    ...(options.rules ? (["rules"] as const) : []),
    "make",
    ...(options.connect ? (["connect"] as const) : []),
    "check",
    "finish",
  ];
}

/** The parts of the window a spec asks for: the card, then one part per declared Action. */
export function specParts(spec: Pick<CapabilitySpec, "tools">): readonly NarrationPart[] {
  return ["card", ...spec.tools.map((tool: CapabilityTool) => PART_OF_UNIT[tool])];
}

/** The fields linked by the link step, said the way a sentence names them. */
export function linkedFields(
  spec: CapabilitySpec,
  linked: Linked,
): readonly { readonly field: string; readonly target: string }[] {
  return spec.schema.fields.flatMap((field) => {
    const relation = linked.relations.find((each) => each.field === field.name);
    const target = linked.flagged.find(({ id }) => id === relation?.to.capability);
    return target ? [{ field: labelInSentence(field.label), target: target.plural_noun }] : [];
  });
}

/** Each Action's house rules as the window draws them: started, or written (or carried over). */
function rulesOf(progress: BehavioralTestFreezeProgress) {
  return progress.actions.flatMap(({ action, status }) => {
    if (status === "pending") return [];
    const state: NarrationRulesState = status === "generating" ? "writing" : "written";
    return [{ kind: "rules", part: PART_OF_UNIT[action], state } as const];
  });
}

export interface BuildNarration {
  readonly plan: (stages: readonly NarrationStage[]) => Promise<void>;
  readonly stage: (stage: NarrationStage) => Promise<void>;
  readonly opening: (text: string) => Promise<void>;
  readonly shape: (spec: CapabilitySpec) => Promise<void>;
  /** The house rules, told for each Action's part as its rules start and once they are written. */
  readonly rules: (progress: BehavioralTestFreezeProgress) => Promise<void>;
  readonly part: (unit: Pick<UnitDescriptor, "name">, state: NarrationPartState) => Promise<void>;
  readonly connect: (spec: CapabilitySpec, linked: Linked) => Promise<void>;
  readonly finish: () => Promise<void>;
  /** Unit generation, told as parts being made, and remade when a fix is needed. */
  readonly units: UnitGenerationObserver;
  /** The Gate, told as checks under way and repairs being made. */
  readonly gate: GateObserver;
}

/**
 * The narration of one build or evolution. `startedAt` is the caller's clock reading for when
 * the person started waiting, so the last line can say how long the wait was.
 */
export function narrateBuild(send: SendBuildEvent, startedAt: number): BuildNarration {
  // `<` and `&` are escaped so a fact htmx swapped in as markup, with no narrator to take it,
  // stays text; JSON reads the escapes back as the characters they stand for.
  const emit = (fact: ProgressFact) =>
    send(PROGRESS_EVENT, JSON.stringify(fact).replace(/</g, "\\u003c").replace(/&/g, "\\u0026"));
  // A send that fails means the reader left: the build's own checks of `isAborted` deal with
  // that, so a lost fact is dropped rather than raised into the Gate or the rules being written.
  const quietly = (fact: ProgressFact) =>
    Promise.resolve()
      .then(() => emit(fact))
      .catch(() => {});
  // The Gate's observer cannot wait.
  const tell = (fact: ProgressFact) => {
    quietly(fact);
  };
  let planned: readonly NarrationStage[] = [];
  const plan = (stages: readonly NarrationStage[]) => {
    planned = stages;
    return emit({ kind: "plan", stages });
  };
  const part = (unit: Pick<UnitDescriptor, "name">, state: NarrationPartState) =>
    emit({ kind: "part", part: PART_OF_UNIT[unit.name], state });
  const ruled = new Map<NarrationPart, NarrationRulesState>();

  return {
    plan,
    stage: (stage) => emit({ kind: "stage", stage }),
    opening: (text) => emit({ kind: "opening", text }),
    shape: (spec) =>
      emit({
        kind: "shape",
        label: spec.label,
        noun: spec.noun,
        plural: spec.plural_noun,
        fields: spec.schema.fields
          .filter((field) => field.lifecycle === "active")
          .map((field) => field.label),
        parts: specParts(spec),
      }),
    rules: async (progress) => {
      for (const fact of rulesOf(progress)) {
        if (ruled.get(fact.part) === fact.state) continue;
        ruled.set(fact.part, fact.state);
        await quietly(fact);
      }
    },
    part,
    connect: async (spec, linked) => {
      const links = linkedFields(spec, linked);
      // Nothing connected after all, so the square promised for it is taken back.
      if (links.length === 0 && planned.includes("connect"))
        await plan(planned.filter((stage) => stage !== "connect"));
      if (links.length === 0) return;
      await emit({ kind: "stage", stage: "connect" });
      await emit({ kind: "connect", links });
    },
    finish: async () => {
      await emit({ kind: "stage", stage: "finish" });
      await emit({ kind: "finish", elapsedMs: Math.round(performance.now() - startedAt) });
    },
    units: {
      onUnitStart: ({ unit, attempt }) => part(unit, attempt > 1 ? "mending" : "making"),
      onUnitGenerated: (unit: GeneratedUnit) => part(unit, "made"),
    },
    gate: {
      onRung: (rung) => tell({ kind: "check", check: CHECK_OF_RUNG[rung] }),
      onRepair: (units) => {
        tell({ kind: "stage", stage: "mend" });
        for (const name of units)
          tell({ kind: "part", part: PART_OF_UNIT[name], state: "mending" });
      },
      onRepaired: () => tell({ kind: "stage", stage: "check" }),
    },
  };
}

/** Two unit observers as one, the first heard first: the developer panel, then the narration. */
export function bothUnitObservers(
  first: UnitGenerationObserver,
  second: UnitGenerationObserver,
): UnitGenerationObserver {
  return {
    onUnitStart: async (event) => {
      await first.onUnitStart?.(event);
      await second.onUnitStart?.(event);
    },
    onUnitPartial: async (event) => {
      await first.onUnitPartial?.(event);
      await second.onUnitPartial?.(event);
    },
    onUnitAttempt: async (event) => {
      await first.onUnitAttempt?.(event);
      await second.onUnitAttempt?.(event);
    },
    onUnitGenerated: async (unit) => {
      await first.onUnitGenerated?.(unit);
      await second.onUnitGenerated?.(unit);
    },
  };
}
