// 听写数字子模式 (Diktat numbers) — pure generators, no LLM, no Dexie.
//
// Produces {display, spoken, canonical} triples: TTS speaks `spoken`, the user
// types the digits, and the answer is checked against `canonical` with tolerant
// formatting (3,50 / 3.50 both accepted; spaces and dashes in phone numbers
// ignored). Randomness is injected (rng: () => number in [0,1)) so tests and
// repeat-avoidance stay deterministic.

export type NumberKind = "phone" | "price" | "time";

export interface NumberItem {
  kind: NumberKind;
  /** What the exercise shows after the reveal, e.g. "3,50 €". */
  display: string;
  /** What the TTS speaks, e.g. "drei Euro fünfzig". */
  spoken: string;
  /** Canonical digit string the typed answer is normalized against. */
  canonical: string;
}

const UNITS = [
  "null",
  "eins",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
];

const TEENS = [
  "zehn",
  "elf",
  "zwölf",
  "dreizehn",
  "vierzehn",
  "fünfzehn",
  "sechzehn",
  "siebzehn",
  "achtzehn",
  "neunzehn",
];

const TENS = [
  "",
  "",
  "zwanzig",
  "dreißig",
  "vierzig",
  "fünfzig",
  "sechzig",
  "siebzig",
  "achtzig",
  "neunzig",
];

/** 0–99 in German words. `standalone: false` uses "ein" instead of "eins"
 *  (ein Euro, einundzwanzig is handled internally). */
export function germanNumber(n: number, standalone = true): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error(`germanNumber: out of range ${n}`);
  }
  if (n < 10) return n === 1 && !standalone ? "ein" : UNITS[n]!;
  if (n < 20) return TEENS[n - 10]!;
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  if (unit === 0) return TENS[tens]!;
  const unitWord = unit === 1 ? "ein" : UNITS[unit]!;
  return `${unitWord}und${TENS[tens]!}`;
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** German mobile-style phone number, spoken digit by digit (A1 exam style). */
export function generatePhone(rng: () => number): NumberItem {
  const prefix = pick(rng, ["0151", "0160", "0170", "0176", "0179"] as const);
  const rest = Array.from({ length: 7 }, () => randInt(rng, 0, 9));
  const digits = prefix + rest.join("");
  const display = `${prefix} ${rest.slice(0, 3).join("")} ${rest.slice(3).join("")}`;
  const spoken = [...digits].map((d) => UNITS[Number(d)]!).join(", ");
  return { kind: "phone", display, spoken, canonical: digits };
}

/** Price 0,50 € – 99,90 €, spoken the everyday way: "drei Euro fünfzig". */
export function generatePrice(rng: () => number): NumberItem {
  const euros = randInt(rng, 0, 99);
  const cents = pick(rng, [0, 10, 20, 25, 50, 75, 80, 90, 95, 99] as const);
  const display = `${euros},${String(cents).padStart(2, "0")} €`;
  let spoken: string;
  if (euros === 0) {
    spoken = `${germanNumber(cents)} Cent`;
  } else if (cents === 0) {
    spoken = `${germanNumber(euros, false)} Euro`;
  } else {
    spoken = `${germanNumber(euros, false)} Euro ${germanNumber(cents)}`;
  }
  return {
    kind: "price",
    display,
    spoken,
    canonical: `${euros},${String(cents).padStart(2, "0")}`,
  };
}

/** Clock time, spoken formally ("acht Uhr fünfzehn") — the unambiguous form
 *  the Goethe A1 listening section uses for announcements. */
export function generateTime(rng: () => number): NumberItem {
  const hour = randInt(rng, 0, 23);
  const minute = pick(rng, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] as const);
  const display = `${hour}:${String(minute).padStart(2, "0")} Uhr`;
  const spoken =
    minute === 0
      ? `${germanNumber(hour, false)} Uhr`
      : `${germanNumber(hour, false)} Uhr ${germanNumber(minute)}`;
  return {
    kind: "time",
    display,
    spoken,
    canonical: `${hour}:${String(minute).padStart(2, "0")}`,
  };
}

export function generateNumberItem(
  kind: NumberKind,
  rng: () => number,
): NumberItem {
  switch (kind) {
    case "phone":
      return generatePhone(rng);
    case "price":
      return generatePrice(rng);
    case "time":
      return generateTime(rng);
  }
}

/** Tolerant digit comparison: strips spaces/dashes/slashes; for prices accepts
 *  "." for ",", a missing cents part ("3" = "3,00") and a trailing €; for times
 *  accepts "." or ":" and a missing leading zero in minutes ("8:5" ≠ "8:50" —
 *  minutes must still be the right value). */
export function matchesNumber(
  kind: NumberKind,
  canonical: string,
  typed: string,
): boolean {
  const t = typed.trim();
  if (t.length === 0) return false;
  if (kind === "phone") {
    return t.replace(/[\s\-/()]/g, "") === canonical;
  }
  if (kind === "price") {
    const cleaned = t.replace(/[€\s]|euro/gi, "").replace(".", ",");
    const norm = cleaned.includes(",") ? cleaned : `${cleaned},00`;
    const [e = "", c = ""] = norm.split(",");
    const canonicalParts = canonical.split(",");
    return (
      String(Number(e)) === String(Number(canonicalParts[0])) &&
      c.padEnd(2, "0") === canonicalParts[1]
    );
  }
  // time
  const cleaned = t.replace(/\s|uhr/gi, "").replace(".", ":");
  const [h = "", m = "0"] = cleaned.split(":");
  const [ch = "", cm = ""] = canonical.split(":");
  return (
    String(Number(h)) === String(Number(ch)) &&
    String(Number(m)) === String(Number(cm))
  );
}
