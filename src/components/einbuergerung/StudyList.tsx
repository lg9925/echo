"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { listAllQuizProgress, listQuizQuestions, setQuizStar } from "@/lib/db";
import { correctOption } from "@/lib/einbuergerung/exam";
import type { QuizQuestion } from "@/lib/types";

/**
 * 背诵清单 — the starred (collected) questions as a compact reference table
 * (like the keyword cheat-sheet): 题号 + 题干 + 答案, bilingual. The 题号 is a
 * link that jumps into practice for just that question. A manually-curated list,
 * like the 字词表.
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
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border-y border-zinc-200 dark:border-zinc-800">
          {items.map((q) => {
            const right = correctOption(q);
            return (
              <div key={q.id} className="flex gap-3 py-2.5">
                {/* 题号 — click to practise this question */}
                <button
                  type="button"
                  onClick={() => onPractice([q])}
                  title={t("practiceThis")}
                  className="shrink-0 w-12 pt-0.5 text-left text-sm font-mono text-blue-600 dark:text-blue-400 hover:underline underline-offset-2"
                >
                  #{q.id}
                </button>

                {/* 题干 + 答案 */}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm leading-snug">{q.question_de}</p>
                  <p className="text-xs text-zinc-400">{q.question_zh}</p>
                  <p className="text-sm">
                    <span className="text-green-700 dark:text-green-400 font-medium">
                      ✓ {right.de}
                    </span>
                    <span className="text-zinc-400"> · {right.zh}</span>
                  </p>
                </div>

                {/* unstar */}
                <button
                  type="button"
                  onClick={() => void unstar(q.id)}
                  aria-label={t("unstar")}
                  title={t("unstar")}
                  className="shrink-0 self-start text-amber-500 text-base leading-none pt-0.5"
                >
                  ★
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
