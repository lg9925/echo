// User-facing client settings, persisted in localStorage. No React here.
//
// The shared secret (apiToken) and an optional API base override live here.
// The frontend never holds vendor keys — only the one token the server checks.

const TOKEN_KEY = "echo:apiToken";
const BASE_KEY = "echo:apiBase";

// Build-time default. `deploy.sh` sets NEXT_PUBLIC_API_URL before `pnpm build`;
// static export inlines it. Falls back to the production subdomain.
export const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "https://api.echo.helloworldhub.xyz";

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
