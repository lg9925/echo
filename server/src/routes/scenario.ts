import { Hono, type Context } from "hono";

// RETIRED: /v1/scenario and /v1/scenario/stream. Both old handlers ran the LLM
// synchronously inside one request, so a slow scenario (claude-cli ~120s) blew
// the Cloudflare ~100s edge timeout → 524 (an HTML page the client decoded as
// the opaque "http_error"). Scenario now runs through the async job queue —
// POST /v1/jobs {task:"scenario", input} then poll GET /v1/jobs/:id — which is
// immune to the edge timeout (the LLM still runs via llm/index's scenarioStream,
// just off the request path). See server/CLAUDE.md → async jobs.
//
// This stub stays mounted so any stale client (old cached SW) hitting the old
// endpoint gets an immediate, clear error instead of a silent 120s → 524 hang.
const route = new Hono();

const gone = (c: Context) =>
  c.json(
    {
      error: "gone",
      detail:
        "POST /v1/scenario is retired — submit POST /v1/jobs {task:'scenario', input} and poll GET /v1/jobs/:id.",
    },
    410,
  );

route.all("/", gone);
route.all("/stream", gone);

export default route;
