"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { addSentenceToIsland, getOrCreatePickedIsland } from "@/lib/cards";
import { upsertVocab } from "@/lib/vocab";
import type { AskResult, TargetLanguage } from "@/lib/api/contracts";

type AskExample = AskResult["examples"][number];
type AskWord = AskResult["words"][number];

// A Q&A answer: the prose explanation plus the savable bits the model pulled out
// — example sentences (one-tap into the picked-up island) and key words (one-tap
// into 字词表). Shared by the assistant thread and the inbox card so both surfaces
// render answers identically. The question itself is persisted by the inbox; the
// learner still decides which sentences/words are worth keeping.
export function AskAnswer({
  text,
  examples,
  words,
  lang,
}: {
  text: string;
  examples: AskExample[];
  words: AskWord[];
  lang: TargetLanguage;
}) {
  const t = useTranslations("assistant");
  const tInbox = useTranslations("inbox");
  const [savedEx, setSavedEx] = useState<Set<number>>(new Set());
  const [savedWord, setSavedWord] = useState<Set<number>>(new Set());

  async function addExample(idx: number, ex: AskExample) {
    if (savedEx.has(idx)) return;
    const island = await getOrCreatePickedIsland(lang, tInbox("pickedIsland"));
    await addSentenceToIsland(island, {
      native: ex.native,
      target: ex.target,
      ipa: null,
      frame: "",
      literal: "",
      note: "",
      variants: [],
    });
    setSavedEx((s) => new Set(s).add(idx));
  }

  async function collectWord(idx: number, w: AskWord) {
    if (savedWord.has(idx)) return;
    await upsertVocab(lang, w.term, w.meaning, []);
    setSavedWord((s) => new Set(s).add(idx));
  }

  return (
    <div className="space-y-2 text-zinc-700 dark:text-zinc-300">
      <p className="whitespace-pre-wrap">{text}</p>

      {examples.length > 0 && (
        <ul className="space-y-1.5">
          {examples.map((ex, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{ex.target}</span>
                <span className="block text-xs text-zinc-500">{ex.native}</span>
              </span>
              <button
                type="button"
                onClick={() => addExample(idx, ex)}
                disabled={savedEx.has(idx)}
                className="shrink-0 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-600 dark:text-zinc-300 disabled:opacity-50"
              >
                {savedEx.has(idx) ? t("saved") : t("addExample")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {words.length > 0 && (
        <ul className="space-y-1.5">
          {words.map((w, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1">
                <span className="font-medium">{w.term}</span>
                <span className="block text-xs text-zinc-500">{w.meaning}</span>
              </span>
              <button
                type="button"
                onClick={() => collectWord(idx, w)}
                disabled={savedWord.has(idx)}
                className="shrink-0 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-600 dark:text-zinc-300 disabled:opacity-50"
              >
                {savedWord.has(idx) ? t("saved") : t("collectWord")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
