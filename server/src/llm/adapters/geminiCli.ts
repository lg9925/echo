import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { LlmAdapter, LlmCompleteParams } from "./types";

// Local-dev adapter: shells out to the Gemini CLI (`gemini -p`) so calls go
// through your local Google login (free tier) instead of the metered Gemini
// API key. (Google Antigravity ships no headless CLI, so the Gemini CLI is the
// local-Google option.) Route with LLM_*_PROVIDER=gemini-cli.
const BIN = process.env.GEMINI_CLI_PATH ?? "gemini";
const TIMEOUT_MS = Number(process.env.GEMINI_CLI_TIMEOUT_MS ?? 360_000);

function baseArgs(model: string, outputFormat: "text" | "stream-json"): string[] {
  // Content (incl. Chinese) goes via stdin; `-p` triggers headless mode and is
  // appended to stdin. `--skip-trust` is required in a non-interactive/temp cwd.
  const args = ["-p", ".", "-o", outputFormat, "--skip-trust"];
  // The CLI rejects API-style names (gemini-2.0-flash 404s); only pass a model
  // when it's a gemini-* name, else use the CLI's default ("auto" routing).
  if (model.startsWith("gemini")) args.push("-m", model);
  return args;
}

function run(
  args: string[],
  input: string,
  onStdout: (chunk: string) => void,
): Promise<{ stderr: string }> {
  return new Promise<{ stderr: string }>((resolve, reject) => {
    const child = spawn(BIN, args, {
      cwd: tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
      // The npm-global `gemini` is a shim (gemini.cmd) on Windows → needs a shell.
      shell: process.platform === "win32",
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("gemini CLI timed out"));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => onStdout(d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ stderr });
    });
    child.stdin.write(input, "utf8");
    child.stdin.end();
  });
}

export const geminiCliAdapter: LlmAdapter = {
  name: "gemini-cli",

  async complete({ system, user, model }: LlmCompleteParams) {
    let out = "";
    const { stderr } = await run(baseArgs(model, "text"), `${system}\n\n${user}`, (c) => (out += c));
    // The CLI exits 0 even on errors, so rely on output instead of the code.
    const text = out.trim();
    if (!text) throw new Error(`gemini CLI produced no output: ${stderr.slice(0, 300)}`);
    return text;
  },

  // Stream text deltas (stream-json: assistant messages with delta:true).
  async completeStream({ system, user, model }: LlmCompleteParams, onText) {
    let acc = "";
    let lineBuf = "";
    const handleLine = (line: string) => {
      const t = line.trim();
      if (!t) return;
      let obj: unknown;
      try {
        obj = JSON.parse(t);
      } catch {
        return;
      }
      const e = obj as { type?: string; role?: string; delta?: boolean; content?: string };
      if (e.type === "message" && e.role === "assistant" && e.delta === true && typeof e.content === "string") {
        acc += e.content;
        onText(acc);
      }
    };
    const { stderr } = await run(baseArgs(model, "stream-json"), `${system}\n\n${user}`, (chunk) => {
      lineBuf += chunk;
      let nl: number;
      while ((nl = lineBuf.indexOf("\n")) >= 0) {
        handleLine(lineBuf.slice(0, nl));
        lineBuf = lineBuf.slice(nl + 1);
      }
    });
    if (lineBuf) handleLine(lineBuf);
    if (!acc.trim()) throw new Error(`gemini CLI produced no output: ${stderr.slice(0, 300)}`);
    return acc;
  },
};
