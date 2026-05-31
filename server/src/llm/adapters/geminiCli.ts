import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { LlmAdapter, LlmCompleteParams } from "./types";

// Local-dev adapter: shells out to the Gemini CLI (`gemini -p`) so calls go
// through your local Google login (free tier) instead of the metered Gemini
// API key. (Google Antigravity ships no headless CLI, so the Gemini CLI is the
// local-Google option.) Route with LLM_*_PROVIDER=gemini-cli.
const BIN = process.env.GEMINI_CLI_PATH ?? "gemini";
const TIMEOUT_MS = Number(process.env.GEMINI_CLI_TIMEOUT_MS ?? 360_000);

export const geminiCliAdapter: LlmAdapter = {
  name: "gemini-cli",
  async complete({ system, user, model }: LlmCompleteParams) {
    // Prompt content (incl. Chinese) goes via stdin so argv stays ASCII (dodges
    // Windows command-line encoding issues). `-p` triggers headless mode and is
    // appended to stdin. `--skip-trust` is required in non-interactive/temp cwd.
    const args = ["-p", ".", "-o", "text", "--skip-trust"];
    // The CLI rejects API-style names (e.g. gemini-2.0-flash 404s); only pass a
    // model when it's a gemini-* name, otherwise use the CLI's own default.
    if (model.startsWith("gemini")) args.push("-m", model);

    return await new Promise<string>((resolve, reject) => {
      const child = spawn(BIN, args, {
        cwd: tmpdir(),
        stdio: ["pipe", "pipe", "pipe"],
        // The npm-global `gemini` is a shim (gemini.cmd) on Windows → needs a shell.
        shell: process.platform === "win32",
      });

      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("gemini CLI timed out"));
      }, TIMEOUT_MS);

      child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", () => {
        clearTimeout(timer);
        // The CLI exits 0 even on errors, so rely on output instead of the code.
        const text = out.trim();
        if (!text) {
          reject(new Error(`gemini CLI produced no output: ${err.slice(0, 300)}`));
          return;
        }
        resolve(text);
      });

      child.stdin.write(`${system}\n\n${user}`, "utf8");
      child.stdin.end();
    });
  },
};
