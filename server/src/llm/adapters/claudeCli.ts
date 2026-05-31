import { spawn } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LlmAdapter } from "./types";

// Local-dev adapter: shells out to the Claude Code CLI (`claude -p`) so calls
// go through your Claude subscription instead of the metered Anthropic API.
// Production still uses the `anthropic` adapter (API key). Route to this with
// LLM_AUTHORING_PROVIDER=claude-cli (see .env.example).

const BIN =
  process.env.CLAUDE_CLI_PATH ??
  (process.platform === "win32" ? "claude.exe" : "claude");

// Generous: scenario generates 15+ cards in one call, which the CLI can take
// several minutes to produce (cold start + large output).
const TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS ?? 360_000);

// Our config uses API model names; the CLI takes aliases.
function cliModel(model: string): string {
  if (model.includes("opus")) return "opus";
  if (model.includes("haiku")) return "haiku";
  if (model.includes("sonnet")) return "sonnet";
  return model;
}

export const claudeCliAdapter: LlmAdapter = {
  name: "claude-cli",
  async complete({ system, user, model }) {
    // System prompt via a UTF-8 temp file + user via stdin → nothing non-ASCII
    // on argv, sidestepping Windows command-line encoding issues. cwd is a
    // temp dir so no project CLAUDE.md is loaded into the CLI's context.
    const sysFile = join(tmpdir(), `echo-sys-${randomUUID()}.txt`);
    await writeFile(sysFile, system, "utf8");
    try {
      return await new Promise<string>((resolve, reject) => {
        const child = spawn(
          BIN,
          [
            "-p",
            "--output-format",
            "text",
            "--model",
            cliModel(model),
            "--system-prompt-file",
            sysFile,
            // Trim cold-start: skip global MCP health-checks and session writes.
            "--strict-mcp-config",
            "--no-session-persistence",
          ],
          { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] },
        );

        let out = "";
        let err = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("claude CLI timed out"));
        }, TIMEOUT_MS);

        child.stdout.on("data", (d) => (out += d.toString("utf8")));
        child.stderr.on("data", (d) => (err += d.toString("utf8")));
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve(out.trim());
          else reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 300)}`));
        });

        child.stdin.write(user, "utf8");
        child.stdin.end();
      });
    } finally {
      await rm(sysFile, { force: true });
    }
  },
};
