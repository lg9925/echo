// User-facing client settings, persisted in localStorage. No React here.
//
// The shared secret (apiToken) and an optional API base override live here.
// The frontend never holds vendor keys — only the one token the server checks.

const TOKEN_KEY = "echo:apiToken";
const BASE_KEY = "echo:apiBase";
const MAX_ISLAND_KEY = "echo:maxIslandSentences";

// Build-time default. `deploy.sh` sets NEXT_PUBLIC_API_URL before `pnpm build`;
// static export inlines it. Falls back to the production subdomain.
export const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://api.echo.helloworldhub.xyz";

// 一个岛的句子上限 —— 也是生成场景时自动拆子岛的阈值。默认 10:初学者一天能背完、
// 又不把间隔重复的复习量压垮的甜点区(宪法 原则三:8–12,软上限 15)。
export const DEFAULT_MAX_ISLAND_SENTENCES = 10;
export const MIN_ISLAND_SENTENCES = 6;
export const MAX_ISLAND_SENTENCES = 15;

function read(key: string): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key) ?? "";
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  const v = value.trim();
  if (v) window.localStorage.setItem(key, v);
  else window.localStorage.removeItem(key);
}

export function getApiToken(): string {
  return read(TOKEN_KEY);
}

export function setApiToken(token: string): void {
  write(TOKEN_KEY, token);
}

/** Empty string means "use DEFAULT_API_BASE". */
export function getApiBaseOverride(): string {
  return read(BASE_KEY);
}

export function setApiBaseOverride(base: string): void {
  write(BASE_KEY, base);
}

/** The base actually used for requests: override if set, else the default. */
export function resolveApiBase(): string {
  return getApiBaseOverride() || DEFAULT_API_BASE;
}

/** Max sentences per island = the auto-split threshold for generated scenarios.
 *  Clamped to [MIN, MAX]; falls back to the default if unset/garbage. */
export function getMaxIslandSentences(): number {
  const raw = parseInt(read(MAX_ISLAND_KEY), 10);
  if (!Number.isFinite(raw)) return DEFAULT_MAX_ISLAND_SENTENCES;
  return Math.min(MAX_ISLAND_SENTENCES, Math.max(MIN_ISLAND_SENTENCES, raw));
}

export function setMaxIslandSentences(n: number): void {
  write(MAX_ISLAND_KEY, String(n));
}

// --- A1 course: daily time target (M1 composer) ---
// Hidden advanced setting (原则一): the composer plans against it, the user
// never has to touch it. Clamped to [MVD, 4h].

const A1_DAILY_KEY = "echo:a1DailyMinutes";
export const DEFAULT_A1_DAILY_MINUTES = 120;
export const MIN_A1_DAILY_MINUTES = 20;
export const MAX_A1_DAILY_MINUTES = 240;

export function getA1DailyMinutes(): number {
  const raw = parseInt(read(A1_DAILY_KEY), 10);
  if (!Number.isFinite(raw)) return DEFAULT_A1_DAILY_MINUTES;
  return Math.min(MAX_A1_DAILY_MINUTES, Math.max(MIN_A1_DAILY_MINUTES, raw));
}

export function setA1DailyMinutes(n: number): void {
  write(A1_DAILY_KEY, String(n));
}
