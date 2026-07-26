// "今天的下一个动作" fixed-priority heuristic, used by the A1 course home.
// The budget-weighted composer (src/lib/composer.ts) drives the de hub's Today
// surface; this stays as the A1 home's cheap fallback: due/new cards → card
// session; no input yet today → shadow; no output yet → daily output task
// (offline-capable via self-check); otherwise a dictation round; all MVD boxes
// ticked → done (extras optional).

import type { StudyDay } from "../types";
import { isMvd } from "../studyLog";

export type NextActionKind = "cards" | "shadow" | "output" | "diktat" | "done";

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
  if (day.outputUnits < 1) return "output";
  if (!isMvd(day)) return "diktat";
  return "done";
}
