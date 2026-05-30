import type { MiddlewareHandler } from "hono";
import { ECHO_API_TOKEN } from "./config";

// Bearer-token gate for /v1/*. The frontend stores this token in its Settings
// page and sends it as `Authorization: Bearer <token>`. A later Cloudflare
// Access layer can sit in front of this without touching the code.
export const auth: MiddlewareHandler = async (c, next) => {
  if (!ECHO_API_TOKEN) {
    return c.json(
      { error: "server_misconfigured", detail: "ECHO_API_TOKEN is not set" },
      500,
    );
  }
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token !== ECHO_API_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};
