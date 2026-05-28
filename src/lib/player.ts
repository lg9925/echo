export type PlayerMode = "bilingual" | "target-only";

export interface PlayerSettings {
  mode: PlayerMode;
  rate: number;
  pauseSec: number;
  gapSec: number;
  loop: "all" | { startIdx: number; endIdx: number };
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  mode: "bilingual",
  rate: 1,
  pauseSec: 3,
  gapSec: 1,
  loop: "all",
};

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
