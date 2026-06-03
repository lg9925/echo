// Lightweight per-language learner profile (CEFR level + free-text
// background/goal), persisted in localStorage. Sent to the backend as optional
// generation context so authored sentences fit the learner. No React.
//
// The profile is DATA only — the prompt wording that uses it lives server-side
// (server/src/llm/prompts.ts), per project principle 五.

import type { LearnerProfile } from "./api/contracts";

export const EMPTY_PROFILE: LearnerProfile = { level: null, background: "" };

function key(language: string): string {
  return `echo:profile:${language}`;
}

export function getProfile(language: string): LearnerProfile {
  if (typeof window === "undefined") return EMPTY_PROFILE;
  try {
    const raw = window.localStorage.getItem(key(language));
    if (!raw) return EMPTY_PROFILE;
    const parsed = JSON.parse(raw) as Partial<LearnerProfile>;
    return {
      level: parsed.level ?? null,
      background: parsed.background ?? "",
    };
  } catch {
    return EMPTY_PROFILE;
  }
}

export function saveProfile(language: string, profile: LearnerProfile): void {
  if (typeof window === "undefined") return;
  try {
    const clean: LearnerProfile = {
      level: profile.level ?? null,
      background: profile.background.trim(),
    };
    window.localStorage.setItem(key(language), JSON.stringify(clean));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function isProfileEmpty(p: LearnerProfile): boolean {
  return !p.level && !p.background.trim();
}

/** The profile for a language, or undefined if empty — for attaching to a
 *  request (omit the field entirely when there's nothing to send). */
export function profileForRequest(language: string): LearnerProfile | undefined {
  const p = getProfile(language);
  return isProfileEmpty(p) ? undefined : p;
}
