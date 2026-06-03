import "./env"; // must be first — loads server/.env before config reads env
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth";
import { rateLimit } from "./ratelimit";
import { PORT } from "./config";
import composeRoute from "./routes/compose";
import glossRoute from "./routes/gloss";
import scenarioRoute from "./routes/scenario";
import splitRoute from "./routes/split";
import keywordsRoute from "./routes/keywords";
import askRoute from "./routes/ask";
import ttsRoute from "./routes/tts";

const app = new Hono();

// CORS: the static frontend lives on a different origin (echo.* vs api.echo.*),
// so cross-origin requests need this. One line, as promised.
app.use("*", cors());

// Public, unauthenticated liveness probe.
app.get("/health", (c) => c.json({ ok: true, service: "echo-server" }));

// Everything under /v1 is rate-limited and token-gated.
const v1 = new Hono();
v1.use("*", rateLimit);
v1.use("*", auth);

// Auth smoke-test route (kept tiny).
v1.get("/ping", (c) => c.json({ pong: true }));

v1.route("/compose", composeRoute);
v1.route("/gloss", glossRoute);
v1.route("/scenario", scenarioRoute);
v1.route("/split", splitRoute);
v1.route("/keywords", keywordsRoute);
v1.route("/ask", askRoute);
v1.route("/tts", ttsRoute);

app.route("/v1", v1);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`echo-server listening on http://127.0.0.1:${info.port}`);
});
