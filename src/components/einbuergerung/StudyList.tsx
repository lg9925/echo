"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { listAllQuizProgress, listQuizQuestions, setQuizStar } from "@/lib/db";
import { correctOption } from "@/lib/einbuergerung/exam";
import { speak } from "@/lib/tts";
import { targetBcp47 } from "@/lib/lang";
import { TargetTokenized } from "../TargetTokenized";
import type { QuizQuestion } from "@/lib/types";

/**
 * 背诵清单 — the starred (collected) questions, shown as flashcard-style entries
 * (题干 + 正确答案 + 提示) to memorise. Like the 字词表: a manually-curated list,
 * each item linking back to "practise this question".
 */
export function StudyList({
  onPractice,
  onBack,
}: {
  onPractice: (questions: QuizQuestion[]) => void;
  onBack: () => void;
}) {
  const t = useTranslations("einbuergerung");
  const [items, setItems] = useState<QuizQuestion[] | null>(null);
  const targetLang = targetBcp47("de");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [prog, all] = await Promise.all([
        listAllQuizProgress(),
        listQuizQuestions(),
      ]);
      const starred = new Set(
        prog.filter((p) => p.starred === 1).map((p) => p.questionId),
      );
      if (!cancelled) setItems(all.filter((q) => starred.has(q.id)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function unstar(id: number) {
    await setQuizStar(id, false);
    setItems((cur) => cur?.filter((q) => q.id !== id) ?? cur);
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-zinc-500 hover:underline underline-offset-4"
        >
          ← {t("back")}
        </button>
        {items && items.length > 0 && (
          <button
            type="button"
            onClick={() => onPractice(items)}
            className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-1.5 text-sm font-medium"
          >
            {t("practiceAllStarred")}
          </button>
        )}
      </header>

      <h1 className="text-2xl font-semibold tracking-tight">
        {t("studyListTitle")}
      </h1>

      {items === null ? (
        <p className="text-sm text-zinc-500">{t("loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("studyListEmpty")}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((q) => {
            const right = correctOption(q);
            return (
              <li
                key={q.id}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-2 bg-white dark:bg-zinc-950"
              >
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>
                    #{q.id} · {q.category}
                  </span>
                  <button
                    type="button"
                    onClick={() => void unstar(q.id)}
                    aria-label={t("unstar")}
                    title={t("unstar")}
                    className="text-amber-500 text-base leading-none"
                  >
                    ★
                  </button>
                </div>

                <TargetTokenized
                  target={q.question_de}
                  onTapWord={(w) => void speak(w, { lang: targetLang })}
                  className="text-base font-medium leading-snug"
                />
                <p className="text-xs text-zinc-500">{q.question_zh}</p>
                {q.literal && (
                  <p className="text-xs text-zinc-400">{q.literal}</p>
                )}

                <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900 px-3 py-2">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    {right.de}
                  </p>
                  <p className="text-xs text-green-700/80 dark:text-green-300/80">
                    {right.zh}
                  </p>
                </div>

                {q.study?.hint_zh && (
                  <p className="text-xs text-zinc-500">💡 {q.study.hint_zh}</p>
                )}

                <button
                  type="button"
                  onClick={() => onPractice([q])}
                  className="text-sm text-zinc-600 dark:text-zinc-300 underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  {t("practiceThis")} →
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
