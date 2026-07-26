// 听写 (Diktat) character diff — pure logic, no React/Dexie.
//
// LCS-based character alignment between the reference sentence and what the
// user typed: the aligned ops drive the colored highlight, the Levenshtein
// distance drives the 0..1 accuracy score that feeds the length ladder
// (diktat.ts), and a word-level pass classifies mistakes into the shared
// ErrorType taxonomy (PHONEME/VOCAB/MORPHOLOGY) for the error-card pipeline.
//
// Normalization is deliberately minimal: whitespace and terminal punctuation
// are forgiven, but CASE AND UMLAUTS STAY STRICT — German orthography
// (capitalized nouns, ä/ö/ü/ß) is part of what dictation trains.

import type { JudgeErrorTag } from "../api/contracts";

export interface DiffOp {
  op: "same" | "sub" | "ins" | "del";
  /** Character from the reference ("del"/"sub"/"same"). */
  ref?: string;
  /** Character the user typed ("ins"/"sub"/"same"). */
  typed?: string;
}

/** Trim, collapse internal whitespace, strip terminal punctuation. Case and
 *  diacritics are NOT touched. */
export function normalizeForDiff(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?…,;:]+$/u, "")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/** 0..1 character accuracy: 1 − levenshtein/refLength, clamped. Inputs are
 *  normalized first, so trailing punctuation and double spaces don't count. */
export function charAccuracy(ref: string, typed: string): number {
  const r = normalizeForDiff(ref);
  const t = normalizeForDiff(typed);
  if (r.length === 0) return t.length === 0 ? 1 : 0;
  return Math.max(0, Math.min(1, 1 - levenshtein(r, t) / r.length));
}

/**
 * Character-level alignment for the highlight render. LCS dynamic program over
 * the normalized strings (A1 sentences ≤ ~120 chars — trivially fast), then a
 * backtrace emitting same/sub/ins/del ops in reading order. Adjacent del+ins
 * pairs are merged into sub so a mistyped letter renders as one marked cell.
 */
export function diffChars(ref: string, typed: string): DiffOp[] {
  const a = normalizeForDiff(ref);
  const b = normalizeForDiff(typed);
  const m = a.length;
  const n = b.length;
  // dp[i][j] = edit distance between a[0..i) and b[0..j)
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      dp[i]![j] === dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
    ) {
      ops.push(
        a[i - 1] === b[j - 1]
          ? { op: "same", ref: a[i - 1], typed: b[j - 1] }
          : { op: "sub", ref: a[i - 1], typed: b[j - 1] },
      );
      i--;
      j--;
    } else if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + 1) {
      ops.push({ op: "del", ref: a[i - 1] });
      i--;
    } else {
      ops.push({ op: "ins", typed: b[j - 1] });
      j--;
    }
  }
  ops.reverse();
  return ops;
}

const UMLAUT_MAP: Record<string, string> = {
  ä: "a",
  ö: "o",
  ü: "u",
  Ä: "A",
  Ö: "O",
  Ü: "U",
  ß: "s",
};

function stripUmlauts(word: string): string {
  return word.replace(/[äöüÄÖÜß]/g, (c) => UMLAUT_MAP[c] ?? c);
}

/** Word-level LCS alignment (exact-match anchors) for error classification. */
function alignWords(
  refWords: string[],
  typedWords: string[],
): Array<{ ref?: string; typed?: string }> {
  const m = refWords.length;
  const n = typedWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        refWords[i - 1] === typedWords[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const pairs: Array<{ ref?: string; typed?: string }> = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && refWords[i - 1] === typedWords[j - 1]) {
      pairs.push({ ref: refWords[i - 1], typed: typedWords[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      pairs.push({ typed: typedWords[j - 1] });
      j--;
    } else {
      pairs.push({ ref: refWords[i - 1] });
      i--;
    }
  }
  pairs.reverse();
  // Merge an adjacent del+ins into a substitution pair (one wrong word).
  const merged: Array<{ ref?: string; typed?: string }> = [];
  for (const p of pairs) {
    const last = merged[merged.length - 1];
    if (last && last.ref !== undefined && last.typed === undefined && p.ref === undefined) {
      last.typed = p.typed;
    } else if (last && last.typed !== undefined && last.ref === undefined && p.typed === undefined) {
      last.ref = p.ref;
    } else {
      merged.push({ ...p });
    }
  }
  return merged;
}

/**
 * Coarse heuristic classification of dictation mistakes into the shared
 * ErrorType taxonomy. Advisory only — these tags never drive stage demotion
 * (srs-error-deck.md soul rule ③-adjacent): ä/ö/ü/ß confusion → PHONEME,
 * a whole missing word → VOCAB (detail = the word), a word wrong only in its
 * ending → MORPHOLOGY:ending, case-only → MORPHOLOGY:capitalization, anything
 * else word-shaped → MORPHOLOGY.
 */
export function classifyDictationErrors(
  ref: string,
  typed: string,
): JudgeErrorTag[] {
  // Strip per-word punctuation for classification (the char diff keeps it; a
  // missed comma is not a VOCAB error and "gut," is not a lexeme).
  const words = (s: string) =>
    normalizeForDiff(s)
      .split(" ")
      .map((w) => w.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ""))
      .filter(Boolean);
  const refWords = words(ref);
  const typedWords = words(typed);
  const tags: JudgeErrorTag[] = [];
  const seen = new Set<string>();
  const push = (type: JudgeErrorTag["type"], detail?: string) => {
    const k = `${type}|${detail ?? ""}`;
    if (seen.has(k)) return;
    seen.add(k);
    tags.push(detail ? { type, detail } : { type });
  };

  for (const pair of alignWords(refWords, typedWords)) {
    const { ref: rw, typed: tw } = pair;
    if (rw !== undefined && tw === undefined) {
      push("VOCAB", rw.toLowerCase());
      continue;
    }
    if (rw === undefined || tw === undefined || rw === tw) continue;
    // Substituted word — classify by how it differs.
    if (rw.toLowerCase() === tw.toLowerCase()) {
      push("MORPHOLOGY", "capitalization");
      continue;
    }
    if (stripUmlauts(rw).toLowerCase() === stripUmlauts(tw).toLowerCase()) {
      const wrongChar = [...rw].find(
        (c, idx) => UMLAUT_MAP[c] !== undefined && tw[idx] !== c,
      );
      push("PHONEME", wrongChar ? `umlaut-${wrongChar.toLowerCase()}` : "umlaut");
      continue;
    }
    const stemLen = Math.min(rw.length, tw.length) - 2;
    if (stemLen >= 2 && rw.slice(0, stemLen) === tw.slice(0, stemLen)) {
      push("MORPHOLOGY", "ending");
      continue;
    }
    push("MORPHOLOGY");
  }
  return tags;
}
