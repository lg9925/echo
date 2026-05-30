import type { MiddlewareHandler } from "hono";

// Best-effort fixed-window per-IP limiter. Single-process, in-memory — enough
// to blunt accidental loops or a leaked token before the bill grows. Not a
// substitute for the Bearer gate; it runs alongside it.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

function clientKey(forwarded: string | undefined, real: string | undefined): string {
  const xff = forwarded?.split(",")[0]?.trim();
  return xff || real || "unknown";
}

export const rateLimit: MiddlewareHandler = async (c, next) => {
  const key = clientKey(
    c.req.header("x-forwarded-for"),
    c.req.header("x-real-ip"),
  );
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    bucket.count += 1;
    if (bucket.count > MAX_PER_WINDOW) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "rate_limited" }, 429);
    }
  }
  await next();
};
