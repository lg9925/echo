"use client";

// Word recognition card: DE lemma (+ article for nouns) + audio → flip →
// meaning + example → self-grade again/good (flashcard form — recognition
// trains recognition, 承重墙 #3).

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { speak } from "@/lib/tts";
import { targetBcp47 } from "@/lib/lang";
import type { Grade } from "@/lib/sr";
import type { WordCardPayload } from "@/lib/types";

export function WordRecognitionCard({
  payload,
  language,
  onGrade,
}: {
  payload: WordCardPayload;
  language: string;
  onGrade: (grade: Grade) => void;
}) {
  const t = useTranslations("a1");
  const [flipped, setFlipped] = useState(false);

  const headword =
    payload.pos === "noun" && payload.article
      ? `${payload.article} ${payload.lemma}`
      : payload.lemma;

  const sayWord = useCallback(() => {
    void speak(headword, { lang: targetBcp47(language) });
  }, [headword, language]);

  useEffect(() => {
    sayWord();
  }, [sayWord]);

  return (
    <>
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-5 bg-white dark:bg-zinc-950 min-h-[280px]">
        <div>
          <p className="text-xs text-zinc-500 mb-1">{t("wordLabel")}</p>
          <button
            type="button"
            onClick={sayWord}
            className="text-3xl font-medium text-left"
          >
            {headword} <span className="text-base align-middle">🔊</span>
          </button>
          {payload.ipa && (
            <p className="text-sm text-zinc-500 font-mono mt-1">/{payload.ipa}/</p>
          )}
        </div>

        {flipped && (
          <>
            <div>
              <p className="text-xs text-zinc-500 mb-1">{t("meaningLabel")}</p>
              <p className="text-xl">{payload.meaningZh}</p>
              {payload.pos === "noun" && "plural" in payload && (
                <p className="text-sm text-zinc-500 mt-1">
                  {t("pluralLabel")}:{" "}
                  {payload.plural ? `die ${payload.plural}` : t("noPlural")}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">{t("exampleLabel")}</p>
              <button
                type="button"
                onClick={() =>
                  void speak(payload.example, { lang: targetBcp47(language) })
                }
                className="text-base text-left"
              >
                {payload.example} <span className="text-sm align-middle">🔊</span>
              </button>
              <p className="text-sm text-zinc-500 mt-0.5">{payload.exampleZh}</p>
            </div>
          </>
        )}
      </section>

      {flipped ? (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onGrade("again")}
            className="py-4 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 font-medium"
          >
            {t("again")}
          </button>
          <button
            type="button"
            onClick={() => onGrade("good")}
            className="py-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium"
          >
            {t("good")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setFlipped(true)}
          className="py-4 rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          {t("showMeaning")}
        </button>
      )}
    </>
  );
}
