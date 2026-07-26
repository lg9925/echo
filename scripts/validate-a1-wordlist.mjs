// Validate public/seed/goethe_a1_de.json — the Goethe A1 word deck seed.
//
// Structural checks always run (schema, noun article/plural invariant, dupes).
// With --online, every noun's article and plural are cross-checked against
// de.wiktionary.org (the "Deutsch Substantiv Übersicht" template). A wrong
// article in the seed trains an error hundreds of times, so any MISMATCH must
// be fixed before shipping; UNVERIFIED entries (no Wiktionary page/template)
// go to the human spot-check list.
//
//   node scripts/validate-a1-wordlist.mjs            # structural only
//   node scripts/validate-a1-wordlist.mjs --online   # + Wiktionary cross-check

import { readFileSync } from "node:fs";

const SOURCE = "public/seed/goethe_a1_de.json";
const VALID_POS = ["noun", "verb", "adj", "adv", "prep", "pron", "num", "phrase", "other"];
const VALID_ARTICLES = ["der", "die", "das"];
const GENUS_TO_ARTICLE = { m: "der", f: "die", n: "das" };

const data = JSON.parse(readFileSync(SOURCE, "utf8"));
const { lexemes } = data;
let errors = 0;

function fail(msg) {
  errors++;
  console.error(`  ✗ ${msg}`);
}

// --- structural checks ---
console.log(`${SOURCE}: ${lexemes.length} lexemes`);
const seen = new Set();
for (const lex of lexemes) {
  const label = `${lex.lemma} (${lex.pos})`;
  if (!lex.lemma || typeof lex.lemma !== "string") fail(`bad lemma: ${JSON.stringify(lex)}`);
  if (!VALID_POS.includes(lex.pos)) fail(`${label}: invalid pos`);
  if (!lex.zh) fail(`${label}: missing zh`);
  if (!lex.example || !lex.example_zh) fail(`${label}: missing example/example_zh`);
  if (!Array.isArray(lex.topics) || lex.topics.length === 0) fail(`${label}: missing topics`);
  const key = `${lex.lemma.toLowerCase()}|${lex.pos}`;
  if (seen.has(key)) fail(`${label}: duplicate lemma+pos`);
  seen.add(key);
  if (lex.pos === "noun") {
    if (!VALID_ARTICLES.includes(lex.article)) fail(`${label}: noun without valid article`);
    if (!("plural" in lex)) fail(`${label}: noun without plural key`);
  } else {
    if ("article" in lex) fail(`${label}: non-noun carries article`);
    if ("plural" in lex) fail(`${label}: non-noun carries plural`);
  }
}
const nouns = lexemes.filter((l) => l.pos === "noun");
console.log(`structural: ${errors === 0 ? "OK" : `${errors} error(s)`} · ${nouns.length} nouns`);
if (lexemes.length < 600) fail(`fewer than 600 lexemes (loader integrity floor)`);

// --- Wiktionary cross-check (--online) ---
if (process.argv.includes("--online")) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mismatches = [];
  const unverified = [];
  let checked = 0;

  // Polite fetch with retry/backoff — Wikimedia rate-limits bursts hard.
  async function fetchWikitext(lemma) {
    const page = encodeURIComponent(lemma);
    const url = `https://de.wiktionary.org/w/api.php?action=parse&page=${page}&prop=wikitext&format=json&formatversion=2&maxlag=5`;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(2000 * 2 ** attempt);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "echo-a1-wordlist-validator/1.0 (personal seed QA)" },
        });
        if (res.status === 429 || res.status >= 500) continue;
        const json = await res.json();
        if (json?.error?.code === "maxlag") continue;
        return json?.parse?.wikitext ?? "";
      } catch {
        // network hiccup → retry
      }
    }
    throw new Error("exhausted retries");
  }

  // Documented pedagogical exceptions (checked-by-hand, not by Wiktionary):
  // Geschwister is plurale tantum in normal usage — A1 teaches "die Geschwister"
  // (like die Eltern), even though Wiktionary lists a rare singular "das
  // Geschwister".
  const ARTICLE_EXCEPTIONS = { Geschwister: "die" };

  for (const lex of nouns) {
    try {
      const text = await fetchWikitext(lex.lemma);
      // A page can hold SEVERAL inflection templates (homonyms: der Schild /
      // das Schild; der Teil / das Teil) and several plural variants (Balkone /
      // Balkons). Aggregate them all; the seed passes if ANY combination
      // matches.
      const templates = [...text.matchAll(/\{\{Deutsch Substantiv Übersicht[\s\S]*?\}\}/g)];
      if (templates.length === 0) {
        unverified.push(lex.lemma);
      } else {
        const wikiArticles = new Set();
        const wikiPlurals = new Set();
        let anyNoPlural = false;
        for (const [block] of templates) {
          for (const m of block.matchAll(/\|\s*Genus(?:\s*\d)?\s*=\s*([mfn])/g)) {
            wikiArticles.add(GENUS_TO_ARTICLE[m[1]]);
          }
          for (const m of block.matchAll(/\|\s*Nominativ Plural(?:\s*\d)?\s*=\s*([^\n|]*)/g)) {
            const p = m[1].trim();
            if (p === "—" || p === "-" || p === "") anyNoPlural = true;
            else wikiPlurals.add(p);
          }
        }
        if (
          wikiArticles.size > 0 &&
          !wikiArticles.has(lex.article) &&
          ARTICLE_EXCEPTIONS[lex.lemma] !== lex.article
        ) {
          mismatches.push(`${lex.lemma}: seed "${lex.article}" vs wiktionary "${[...wikiArticles].join("/")}"`);
        }
        if (lex.plural != null && wikiPlurals.size > 0 && !wikiPlurals.has(lex.plural)) {
          mismatches.push(`${lex.lemma}: seed plural "${lex.plural}" vs wiktionary "${[...wikiPlurals].join("/")}"`);
        } else if (lex.plural != null && wikiPlurals.size === 0 && anyNoPlural) {
          mismatches.push(`${lex.lemma}: seed plural "${lex.plural}" vs wiktionary none`);
        }
        // seed plural=null while wiktionary has one → tolerated (A1 treats rare
        // plurals of mass nouns as none) but listed for spot-check:
        else if (lex.plural == null && wikiPlurals.size > 0) {
          unverified.push(`${lex.lemma} (seed: no plural, wiktionary: ${[...wikiPlurals].join("/")})`);
        }
      }
    } catch {
      unverified.push(`${lex.lemma} (fetch failed)`);
    }
    checked++;
    if (checked % 50 === 0) console.log(`  …${checked}/${nouns.length}`);
    await sleep(400);
  }

  console.log(`\nonline cross-check: ${checked} nouns`);
  if (mismatches.length > 0) {
    console.error(`MISMATCHES (${mismatches.length}) — fix before shipping:`);
    for (const m of mismatches) console.error(`  ✗ ${m}`);
    errors += mismatches.length;
  } else {
    console.log("no article/plural mismatches ✓");
  }
  if (unverified.length > 0) {
    console.log(`unverified / spot-check (${unverified.length}):`);
    for (const u of unverified) console.log(`  ? ${u}`);
  }
}

process.exit(errors > 0 ? 1 : 0);
