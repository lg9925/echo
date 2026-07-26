// M1 每日会话编排器 (Session Composer) — a PURE function. No Dexie, no React:
// TodayView assembles the inputs and renders the output. Zero-config (承重墙
// #6): the learner never plans — the composer turns the curriculum's time
// budget, the study log and the due counts into ONE ordered action list, and
// "next" is simply the first unfinished item. The MVD path (≤3 actions,
// ~20 min) is always constructible, offline included.

import type { ActivityClass, CurriculumPhase, StudyDay } from "./types";

// A1 协议时长预算 (hours of the ~120h total) per activity class.
export const BUDGET_H: Record<ActivityClass, number> = {
  input: 48,
  srs: 24,
  output: 20,
  exam: 12,
  hvpt: 8,
  realuse: 4,
  buffer: 4,
};

export const DEFAULT_DAY_TARGET_MIN = 120;
export const MVD_MINUTES = 20;

export type ActionKind =
  | "srs_round"
  | "shadow_input"
  | "dictation"
  | "output_task"
  | "exam_drill"
  | "hvpt_round"
  | "realuse"
  | "buffer";

export interface Action {
  /** Stable per-day id, e.g. "srs_round.1" — completion is matched on kind. */
  id: string;
  cls: ActivityClass;
  kind: ActionKind;
  estMinutes: number;
  requiresOnline: boolean;
  mvdPart: boolean;
}

export interface ComposerInput {
  phase: CurriculumPhase;
  dayTargetMinutes: number;
  /** Lifetime minutes per class (from studyDays). */
  cumMinutes: Partial<Record<ActivityClass, number>>;
  /** Today's rollup (undefined = nothing yet). */
  today: StudyDay | undefined;
  dueCards: number;
  newAllowance: number;
  online: boolean;
  /** P2 content gates. */
  hvptReady: boolean;
  examDrillsReady: boolean;
}

export interface TodayPlan {
  next: Action | null;
  plan: Action[];
  /** Which plan items count as done (parallel to plan). */
  done: boolean[];
  doneMinutes: number;
  targetMinutes: number;
  mvdComplete: boolean;
}

const KIND_TO_CLASS: Record<ActionKind, ActivityClass> = {
  srs_round: "srs",
  shadow_input: "input",
  dictation: "input",
  output_task: "output",
  exam_drill: "exam",
  hvpt_round: "hvpt",
  realuse: "realuse",
  buffer: "buffer",
};

function minutesToday(today: StudyDay | undefined, cls: ActivityClass): number {
  return (today?.msByActivity[cls] ?? 0) / 60_000;
}

/** Whether one instance of this action kind is already done today, judged from
 *  the StudyDay rollup (completion detection = studyLog events, no extra state). */
function kindDone(today: StudyDay | undefined, kind: ActionKind): boolean {
  if (!today) return false;
  switch (kind) {
    case "srs_round":
      return today.srsQueueCleared || today.srsCardsGraded >= 5;
    case "shadow_input":
      return today.inputUnits >= 1;
    case "output_task":
      return today.outputUnits >= 1;
    case "dictation":
      // Counts as done when input time beyond the shadow round exists (~10min).
      return minutesToday(today, "input") >= 20;
    case "exam_drill":
      return minutesToday(today, "exam") >= 10;
    case "hvpt_round":
      return minutesToday(today, "hvpt") >= 8;
    case "realuse":
      return minutesToday(today, "realuse") >= 5;
    case "buffer":
      return false;
  }
}

/**
 * Compose today's ordered plan:
 * 1. phase/content/online gates zero-out unavailable classes;
 * 2. a fixed pedagogical head (retrieval → input → output) that is also the MVD;
 * 3. the remaining minutes fill by largest pace-deficit first, in 8–12 min
 *    chunks, never two consecutive chunks of the same class.
 */
export function composeToday(input: ComposerInput): TodayPlan {
  const target = Math.max(MVD_MINUTES, input.dayTargetMinutes);

  // --- 1. gates → per-class weight (0 = closed today) ---
  const weight: Record<ActivityClass, number> = { ...BUDGET_H };
  if (input.phase !== "exam-prep" || !input.examDrillsReady) weight.exam = 0;
  if (input.phase === "cold-start" || !input.hvptReady) weight.hvpt = 0;

  // --- 2. fixed head (the MVD path) ---
  const srsEst = Math.max(
    5,
    Math.min(25, Math.round(input.dueCards * 0.15 + input.newAllowance * 0.5)),
  );
  const head: Action[] = [
    {
      id: "srs_round.1",
      cls: "srs",
      kind: "srs_round",
      estMinutes: srsEst,
      requiresOnline: false,
      mvdPart: true,
    },
    {
      id: "shadow_input.1",
      cls: "input",
      kind: "shadow_input",
      estMinutes: 15,
      requiresOnline: false,
      mvdPart: true,
    },
    {
      // Offline the task degrades to self-check inside the view — still doable.
      id: "output_task.1",
      cls: "output",
      kind: "output_task",
      estMinutes: 10,
      requiresOnline: false,
      mvdPart: true,
    },
  ];

  // --- 3. deficit-weighted fill ---
  const totalW = (Object.values(weight) as number[]).reduce((a, b) => a + b, 0);
  const cumTotal = (Object.keys(BUDGET_H) as ActivityClass[]).reduce(
    (a, c) => a + (input.cumMinutes[c] ?? 0),
    0,
  );
  const paceMin = cumTotal + target;
  const deficit = new Map<ActivityClass, number>();
  for (const cls of Object.keys(weight) as ActivityClass[]) {
    if (weight[cls] === 0) continue;
    const share = (weight[cls] / totalW) * paceMin;
    deficit.set(cls, Math.max(0, share - (input.cumMinutes[cls] ?? 0)));
  }

  // Per-kind daily caps keep the fill varied (a plan of six identical
  // dictation chunks is honest but demoralizing); buffer absorbs the rest.
  const FILL_CHUNKS: Array<{ kind: ActionKind; minutes: number; max: number }> = [
    { kind: "dictation", minutes: 10, max: 2 },
    { kind: "exam_drill", minutes: 10, max: 2 },
    { kind: "hvpt_round", minutes: 8, max: 2 },
    { kind: "realuse", minutes: 5, max: 1 },
    { kind: "buffer", minutes: 10, max: Infinity },
  ];

  const plan: Action[] = [...head];
  let planned = head.reduce((a, x) => a + x.estMinutes, 0);
  const counts = new Map<ActionKind, number>();
  let lastCls: ActivityClass | null = plan[plan.length - 1]!.cls;
  let guard = 0;
  while (planned < target && guard++ < 50) {
    // Pick the open chunk with the largest remaining class deficit that
    // doesn't repeat the previous class (interleaving between classes).
    const candidates = FILL_CHUNKS.filter((c) => {
      const cls = KIND_TO_CLASS[c.kind];
      if (weight[cls] === 0) return false;
      if ((counts.get(c.kind) ?? 0) >= c.max) return false;
      if (c.kind === "exam_drill" && !input.examDrillsReady) return false;
      if (c.kind === "hvpt_round" && !input.hvptReady) return false;
      return true;
    }).sort(
      (a, b) =>
        (deficit.get(KIND_TO_CLASS[b.kind]) ?? 0) -
        (deficit.get(KIND_TO_CLASS[a.kind]) ?? 0),
    );
    const pick =
      candidates.find((c) => KIND_TO_CLASS[c.kind] !== lastCls) ?? candidates[0];
    if (!pick) break;
    const cls = KIND_TO_CLASS[pick.kind];
    const n = (counts.get(pick.kind) ?? 0) + 1;
    counts.set(pick.kind, n);
    plan.push({
      id: `${pick.kind}.${n}`,
      cls,
      kind: pick.kind,
      estMinutes: pick.minutes,
      requiresOnline: false,
      mvdPart: false,
    });
    planned += pick.minutes;
    deficit.set(cls, Math.max(0, (deficit.get(cls) ?? 0) - pick.minutes));
    lastCls = cls;
  }

  // --- completion + next ---
  const seenPerKind = new Map<ActionKind, number>();
  const done = plan.map((a) => {
    const nth = (seenPerKind.get(a.kind) ?? 0) + 1;
    seenPerKind.set(a.kind, nth);
    // Only the FIRST chunk of a kind can be auto-detected from the rollup;
    // later chunks of the same kind stay open (they're extra volume).
    return nth === 1 && kindDone(input.today, a.kind);
  });
  const next = plan.find((_, i) => !done[i]) ?? null;

  const doneMinutes = (Object.keys(BUDGET_H) as ActivityClass[]).reduce(
    (a, c) => a + minutesToday(input.today, c),
    0,
  );
  const mvdComplete = plan
    .filter((a) => a.mvdPart)
    .every((a) => kindDone(input.today, a.kind));

  return {
    next,
    plan,
    done,
    doneMinutes: Math.round(doneMinutes),
    targetMinutes: target,
    mvdComplete,
  };
}
