export type PlayerMode = "bilingual" | "target-only";

export interface PlayerSettings {
  mode: PlayerMode;
  autoAdvance: boolean;
  rate: number;
  pauseSec: number;
  gapSec: number;
  loop: "all" | { startIdx: number; endIdx: number };
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  mode: "target-only",
  autoAdvance: true,
  rate: 1,
  pauseSec: 3,
  gapSec: 3,
  loop: "all",
};

const STORAGE_KEY = "echo:playerSettings:v1";

export function loadPlayerSettings(): PlayerSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
    // Merge so new fields added in later versions get their defaults.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function savePlayerSettings(settings: PlayerSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* quota exceeded or private mode — ignore */
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function nextIndex(
  currentIdx: number,
  total: number,
  loop: PlayerSettings["loop"],
): number {
  if (loop === "all") {
    return (currentIdx + 1) % total;
  }
  const { startIdx, endIdx } = loop;
  if (currentIdx >= endIdx || currentIdx < startIdx) {
    return startIdx;
  }
  return currentIdx + 1;
}

export function prevIndex(
  currentIdx: number,
  total: number,
  loop: PlayerSettings["loop"],
): number {
  if (loop === "all") {
    return (currentIdx - 1 + total) % total;
  }
  const { startIdx, endIdx } = loop;
  if (currentIdx <= startIdx || currentIdx > endIdx) {
    return endIdx;
  }
  return currentIdx - 1;
}
