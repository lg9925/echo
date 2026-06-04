import { Hono } from "hono";
import { createJob, getJobState, isJobTask, runJob } from "../jobs";

// Single-tenant for now: every job is owned by "owner". The column exists so
// the per-user system (next slice) is a drop-in, no schema migration (原则四).
const OWNER = "owner";

const route = new Hono();

// Submit a slow task → returns a jobId immediately; the work runs in the
// background and the client polls GET /:id for the result.
route.post("/", async (c) => {
  let body: { task?: unknown; input?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  if (!isJobTask(body.task) || body.input == null) {
    return c.json(
      { error: "missing_fields", detail: "need {task, input}" },
      400,
    );
  }
  const id = await createJob(OWNER, body.task, body.input);
  void runJob(id); // background; the long-lived process completes it
  return c.json({ jobId: id });
});

// Poll a job. Cheap + frequent — exempted from the per-IP rate limit (see
// ratelimit.ts).
route.get("/:id", async (c) => {
  const state = await getJobState(c.req.param("id"));
  if (!state) return c.json({ error: "not_found" }, 404);
  return c.json(state);
});

export default route;
