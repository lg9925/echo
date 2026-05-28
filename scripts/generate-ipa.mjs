#!/usr/bin/env node
// Generate IPA pronunciation for every sentence in public/seed/echo_seed_*.json
// using espeak-ng. Writes the result back into the same JSON files in an `ipa`
// field on each sentence, and bumps the top-level `version` so the in-app
// seedLoader will re-ingest.
//
// Usage:
//   node scripts/generate-ipa.mjs            # idempotent: skips sentences with existing ipa
//   node scripts/generate-ipa.mjs --force    # regenerate even if ipa already present
//   ESPEAK_NG_PATH=/path/to/espeak-ng node scripts/generate-ipa.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SEED_DIR = path.join(ROOT, "public", "seed");

const ESPEAK_CANDIDATES = [
  process.env.ESPEAK_NG_PATH,
  "C:\\Program Files\\eSpeak NG\\espeak-ng.exe",
  "C:\\Program Files (x86)\\eSpeak NG\\espeak-ng.exe",
  "/usr/bin/espeak-ng",
  "/usr/local/bin/espeak-ng",
  "/opt/homebrew/bin/espeak-ng",
  "espeak-ng",
].filter(Boolean);

const VOICE_MAP = {
  de: "de",
  en: "en-us",
  fr: "fr-fr",
};

function locateEspeak() {
  for (const candidate of ESPEAK_CANDIDATES) {
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status === 0) return candidate;
  }
  return null;
}

function ipaFor(espeak, voice, text) {
  const result = spawnSync(espeak, ["-v", voice, "--ipa", "-q", text], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `espeak-ng failed for ${voice}/"${text}": ${result.stderr}`,
    );
  }
  // espeak emits one phrase per line on punctuation; flatten to a single line.
  return result.stdout.replace(/\s+/g, " ").trim();
}

async function processFile(file, espeak, force) {
  const fullPath = path.join(SEED_DIR, file);
  const raw = JSON.parse(await fs.readFile(fullPath, "utf8"));
  const voice = VOICE_MAP[raw.language] ?? raw.language;
  let touched = 0;
  for (const island of raw.islands) {
    for (const sentence of island.sentences) {
      if (sentence.ipa && !force) continue;
      sentence.ipa = ipaFor(espeak, voice, sentence.target);
      touched += 1;
    }
  }
  if (touched > 0) {
    raw.version = (raw.version ?? 1) + 1;
    await fs.writeFile(fullPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
  }
  return { file, touched, version: raw.version ?? 1 };
}

async function main() {
  const force = process.argv.includes("--force");
  const espeak = locateEspeak();
  if (!espeak) {
    console.error(
      "espeak-ng not found. Install it or set ESPEAK_NG_PATH.\n" +
        "Windows: winget install eSpeak-NG.eSpeak-NG",
    );
    process.exit(1);
  }
  console.error(`Using ${espeak}`);

  const files = (await fs.readdir(SEED_DIR)).filter(
    (f) => f.startsWith("echo_seed_") && f.endsWith(".json"),
  );
  if (files.length === 0) {
    console.error(`No seed files in ${SEED_DIR}`);
    process.exit(1);
  }

  for (const file of files) {
    const result = await processFile(file, espeak, force);
    console.log(
      `${result.file}: ${result.touched} sentence(s) touched, version=${result.version}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
