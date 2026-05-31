import { spawn } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LlmAdapter, LlmCompleteParams } from "./types";

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

// Trim cold-start: skip global MCP health-checks and session writes.
const COMMON_ARGS = ["--strict-mcp-config", "--no-session-persistence"];

// Our config uses API model names; the CLI takes aliases.
function cliModel(model: string): string {
  if (model.includes("opus")) return "opus";
  if (model.includes("haiku")) return "haiku";
  if (model.includes("sonnet")) return "sonnet";
  return model;
}

// System prompt via a UTF-8 temp file + user via stdin → nothing non-ASCII on
// argv (sidesteps Windows encoding issues). cwd is a temp dir so no project
// CLAUDE.md leaks into the CLI's context. `onStdout` parses incremental output.
async function runClaude(
  args: string[],
  system: string,
  user: string,
  onStdout: (chunk: string) => void,
): Promise<{ code: number | null; stderr: string }> {
  const sysFile = join(tmpdir(), `echo-sys-${randomUUID()}.txt`);
  await writeFile(sysFile, system, "utf8");
  try {
    return await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const child = spawn(BIN, [...args, "--system-prompt-file", sysFile, ...COMMON_ARGS], {
        cwd: tmpdir(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("claude CLI timed out"));
      }, TIMEOUT_MS);

      child.stdout.on("data", (d: Buffer) => onStdout(d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stderr });
      });

      child.stdin.write(user, "utf8");
      child.stdin.end();
    });
  } finally {
    await rm(sysFile, { force: true });
  }
}

export const claudeCliAdapter: LlmAdapter = {
  name: "claude-cli",

  async complete({ system, user, model }: LlmCompleteParams) {
    let out = "";
    const { code, stderr } = await runClaude(
      ["-p", "--output-format", "text", "--model", cliModel(model)],
      system,
      user,
      (chunk) => (out += chunk),
    );
    if (code !== 0) throw new Error(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`);
    return out.trim();
  },

  // Streams text deltas (stream-json). Calls onText with the accumulated text
  // as it arrives; returns the authoritative final text.
  async completeStream({ system, user, model }: LlmCompleteParams, onText) {
    let acc = "";
    let finalText = "";
    let lineBuf = "";

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let obj: unknown;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return;
      }
      const e = obj as {
        type?: string;
        event?: { type?: string; delta?: { type?: string; text?: string } };
        result?: unknown;
      };
      if (
        e.type === "stream_event" &&
        e.event?.type === "content_block_delta" &&
        e.event.delta?.type === "text_delta" &&
        typeof e.event.delta.text === "string"
      ) {
        acc += e.event.delta.text;
        onText(acc);
      } else if (e.type === "result" && typeof e.result === "string") {
        finalText = e.result;
      }
    };

    const { code, stderr } = await runClaude(
      [
        "-p",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--model",
        cliModel(model),
      ],
      system,
      user,
      (chunk) => {
        lineBuf += chunk;
        let nl: number;
        while ((nl = lineBuf.indexOf("\n")) >= 0) {
          handleLine(lineBuf.slice(0, nl));
          lineBuf = lineBuf.slice(nl + 1);
        }
      },
    );
    if (lineBuf) handleLine(lineBuf);
    if (code !== 0) throw new Error(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`);
    return finalText || acc;
  },
};
