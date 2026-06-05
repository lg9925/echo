// Author-time batch: generate word-by-word German→Chinese 逐词直译 for the
// 入籍考试 question bank and write it into each question's `literal` field.
//
// Runs IN-PROCESS through the middle layer (llm/index.ts → einbLiteral), so no
// server / auth / tunnel is involved. Routes the einb_literal task to claude-cli
// (free + strong) by default — override with LLM_EINB_LITERAL_PROVIDER/_MODEL.
//
// Usage (from server/):
//   npx tsx scripts/gen-einb-literal.ts --sample 8        # 8 Qs → *.sample.json
//   npx tsx scripts/gen-einb-literal.ts                   # all, in place
//   npx tsx scripts/gen-einb-literal.ts --ids 1,21,55     # specific ids
//   npx tsx scripts/gen-einb-literal.ts --force           # regenerate existing
//   npx tsx scripts/gen-einb-literal.ts --concurrency 6

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Default the task to claude-cli before importing the LLM core (config reads
// LLM_* env at module load). Set the var, then dynamic-import.
process.env.LLM_EINB_LITERAL_PROVIDER ??= "claude-cli";

const { einbLiteral } = await import("../src/llm/index.js");

interface RawOption {
  de: string;
  zh: string;
  correct: boolean;
  literal?: string | null;
}
interface RawQuestion {
  id: number;
  question_de: string;
  literal?: string | null;
  options: RawOption[];
  [k: string]: unknown;
}
interface Bank {
  meta?: unknown;
  questions: RawQuestion[];
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(
  here,
  "../../public/seed/einbuergerung/leben_in_deutschland_echo_plus.json",
);

const sampleN = arg("sample") ? Number(arg("sample")) : null;
const idsArg = arg("ids");
const ids = idsArg ? new Set(idsArg.split(",").map((s) => Number(s.trim()))) : null;
const force = flag("force");
const concurrency = arg("concurrency") ? Number(arg("concurrency")) : 5;
// "question" (default) → q.literal; "answer" → the correct option's literal.
const what = arg("what") === "answer" ? "answer" : "question";
const out =
  arg("out") ?? (sampleN ? SOURCE.replace(/\.json$/, ".sample.json") : SOURCE);

const correctOf = (q: RawQuestion): RawOption | undefined =>
  q.options.find((o) => o.correct);

async function main() {
  const bank: Bank = JSON.parse(await readFile(SOURCE, "utf8"));

  const has = (q: RawQuestion) =>
    what === "answer" ? !!correctOf(q)?.literal : !!q.literal;

  let targets = bank.questions;
  if (ids) targets = targets.filter((q) => ids.has(q.id));
  if (!force) targets = targets.filter((q) => !has(q));
  if (sampleN) targets = targets.slice(0, sampleN);

  console.log(
    `Generating ${what} literals for ${targets.length} question(s) ` +
      `(provider=${process.env.LLM_EINB_LITERAL_PROVIDER}, concurrency=${concurrency}) → ${out}`,
  );

  let done = 0;
  let failed = 0;
  let writing = false;
  const queue = [...targets];

  // Checkpoint the whole bank periodically so a crash near the end can't lose a
  // long run — re-running then skips questions that already have a literal.
  async function checkpoint() {
    if (writing) return;
    writing = true;
    try {
      await writeFile(out, JSON.stringify(bank, null, 2) + "\n", "utf8");
    } finally {
      writing = false;
    }
  }

  async function worker() {
    for (let q = queue.shift(); q; q = queue.shift()) {
      try {
        if (what === "answer") {
          const opt = correctOf(q);
          if (!opt) throw new Error("no correct option");
          const { literal } = await einbLiteral(opt.de);
          opt.literal = literal;
          done++;
          console.log(`✓ #${q.id}  ${literal}`);
        } else {
          const { literal } = await einbLiteral(q.question_de);
          q.literal = literal;
          done++;
          console.log(`✓ #${q.id}  ${literal}`);
        }
        if (done % 25 === 0) await checkpoint();
      } catch (e) {
        failed++;
        console.error(`✗ #${q.id}  ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker()),
  );

  await writeFile(out, JSON.stringify(bank, null, 2) + "\n", "utf8");
  console.log(`\nDone: ${done} generated, ${failed} failed. Wrote ${out}`);
  if (failed > 0) process.exitCode = 1;
}

await main();
