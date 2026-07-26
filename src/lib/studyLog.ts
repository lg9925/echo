// M2/M7 study-time instrumentation — the SINGLE entry point components call.
//
// logActivity() (a) appends an immutable StudyLogEvent and (b) incrementally
// folds it into today's StudyDay rollup, recomputing the MVD flag — so the
// streak and the dashboards never scan raw events. The activity class is
// derived from `source` here, never picked by a call site (M7: 按活动类型
// 自动归类，无手动记录负担).
//
// logReview() appends the append-only ReviewLogEntry (M7 mature-card retention
// report + future per-user FSRS optimizer — this data cannot be backfilled,
// which is why it ships in P0).

import {
  addReviewLogEntry,
  addStudyLogEvent,
  getStudyDay,
  putStudyDay,
} from "./db";
import { dayKeyLocal } from "./streak";
import type { Grade, SrFields } from "./sr";
import type { ActivityClass, StudyDay, StudyLogEvent } from "./types";

export type StudySource = StudyLogEvent["source"];

const SOURCE_TO_ACTIVITY: Record<StudySource, ActivityClass> = {
  review: "srs",
  cardSession: "srs",
  diktat: "input",
  shadow: "input",
  quiz: "exam",
  outputTask: "output",
  hvpt: "hvpt",
  checkpoint: "exam",
};

// MVD (最低可行日, brief M1/M2): 一轮 SRS + 一条可理解输入 + 一次产出尝试
// (打字或口说均可 — 已确认，保证离线可达成).
export const MVD_MIN_SRS_CARDS = 5;
export const MVD_MIN_INPUT_UNITS = 1;
export const MVD_MIN_OUTPUT_UNITS = 1;

export function isMvd(day: {
  srsQueueCleared: boolean;
  srsCardsGraded: number;
  inputUnits: number;
  outputUnits: number;
}): boolean {
  return (
    (day.srsQueueCleared || day.srsCardsGraded >= MVD_MIN_SRS_CARDS) &&
    day.inputUnits >= MVD_MIN_INPUT_UNITS &&
    day.outputUnits >= MVD_MIN_OUTPUT_UNITS
  );
}

export interface LogActivityInput {
  language: string;
  source: StudySource;
  durationMs: number;
  /** Cards graded / sentences shadowed / questions answered … */
  units: number;
  /** MVD sub-metrics. Defaults are derived from `source` (srs sources count
   *  toward graded cards, input sources toward input units, output sources
   *  toward output units); pass explicit values only where the default is
   *  wrong — e.g. a review with a typed attempt is BOTH one graded card and
   *  one production attempt. */
  counts?: { srsGraded?: number; input?: number; output?: number };
  /** Set when an SRS round finished with an empty queue (MVD's "一轮完成"). */
  srsQueueCleared?: boolean;
  /** Free-form JSON detail stored on the event (e.g. interleave key sequence). */
  detail?: string;
}

function defaultCounts(
  source: StudySource,
  units: number,
): { srsGraded: number; input: number; output: number } {
  const activity = SOURCE_TO_ACTIVITY[source];
  return {
    srsGraded: activity === "srs" ? units : 0,
    input: activity === "input" ? units : 0,
    output: activity === "output" ? units : 0,
  };
}

/** Append one activity event and fold it into today's StudyDay. */
export async function logActivity(input: LogActivityInput): Promise<StudyDay> {
  const now = Date.now();
  const dayKey = dayKeyLocal(now);
  const activity = SOURCE_TO_ACTIVITY[input.source];
  const counts = { ...defaultCounts(input.source, input.units), ...input.counts };

  await addStudyLogEvent({
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    language: input.language,
    activity,
    source: input.source,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    units: input.units,
    dayKey,
    detail: input.detail,
    createdAt: now,
  });

  const prev = await getStudyDay(input.language, dayKey);
  const day: StudyDay = prev ?? {
    id: `${input.language}|${dayKey}`,
    language: input.language,
    dayKey,
    msByActivity: {},
    srsCardsGraded: 0,
    srsQueueCleared: false,
    inputUnits: 0,
    outputUnits: 0,
    mvd: false,
    updatedAt: now,
  };
  day.msByActivity = {
    ...day.msByActivity,
    [activity]: (day.msByActivity[activity] ?? 0) + Math.max(0, input.durationMs),
  };
  day.srsCardsGraded += counts.srsGraded;
  day.inputUnits += counts.input;
  day.outputUnits += counts.output;
  if (input.srsQueueCleared) day.srsQueueCleared = true;
  day.mvd = isMvd(day);
  day.updatedAt = now;
  await putStudyDay(day);
  return day;
}

/** Append one row to the append-only review log. Call at every schedule() call
 *  site, with the PRE-schedule state (its interval is what was scheduled when
 *  this review came due). */
export async function logReview(args: {
  cardId: string;
  deck: "sentence" | "card";
  language: string;
  grade: Grade;
  verdict?: string;
  prev: SrFields;
}): Promise<void> {
  const now = Date.now();
  const { prev } = args;
  const elapsedDays = prev.lastReviewedAt
    ? (now - prev.lastReviewedAt) / 86_400_000
    : 0;
  await addReviewLogEntry({
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    cardId: args.cardId,
    deck: args.deck,
    language: args.language,
    ts: now,
    grade: args.grade,
    verdict: args.verdict,
    scheduledInterval: prev.interval,
    elapsedDays: Math.round(elapsedDays * 100) / 100,
  });
}
