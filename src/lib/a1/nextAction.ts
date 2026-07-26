// P0 "今天的下一个动作" — a deliberately DUMB fixed-priority heuristic.
//
// The budget-weighted session composer is P1 and replaces this wholesale
// (src/lib/composer.ts, per the plan). Keep this stub logic-free enough that
// nothing grows attached to it: due/new cards → card session; no input yet
// today → shadow; no output yet → judged review; otherwise a dictation round;
// all MVD boxes ticked → done (extras optional).

import type { StudyDay } from "../types";
import { isMvd } from "../studyLog";

export type NextActionKind = "cards" | "shadow" | "review" | "diktat" | "done";

export interface NextActionInput {
  dueCardCount: number;
  newAllowance: number;
  /** Today's rollup (undefined = nothing logged yet). */
  day: StudyDay | undefined;
}

export function nextAction(input: NextActionInput): NextActionKind {
  const day = input.day;
  if (input.dueCardCount > 0 || input.newAllowance > 0) return "cards";
  if (!day || day.inputUnits < 1) return "shadow";
  if (!day || day.outputUnits < 1) return "review";
  if (!isMvd(day)) return "diktat";
  return "done";
}
