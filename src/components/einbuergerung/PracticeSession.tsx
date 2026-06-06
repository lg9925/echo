"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { recordQuizAnswer } from "@/lib/db";
import { getShowZh, setShowZh } from "@/lib/einbuergerung/prefs";
import { QuizCard } from "./QuizCard";
import { ZhToggle } from "./ZhToggle";
import type { QuizOption, QuizQuestion } from "@/lib/types";

/**
 * Practice flow over a (pre-filtered) list of questions: instant feedback per
 * card, progress folded into quizProgress, score at the end. Supports back/
 * forward navigation — a question's pick is remembered (and its feedback shown)
 * when you return to it, and it's recorded to quizProgress only once.
 */
export function PracticeSession({
  questions,
  onExit,
}: {
  questions: QuizQuestion[];
  onExit: () => void;
}) {
  const t = useTranslations("einbuergerung");
  const [index, setIndex] = useState(0);
  // index → the option the user picked (locks the card, drives the score).
  const [picks, setPicks] = useState<Map<number, QuizOption>>(new Map());
  const [showZh, setShowZhState] = useState(false);
  // Indices already written to quizProgress — never double-count an answer.
  const recordedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage read after mount (SSR has no localStorage)
    setShowZhState(getShowZh());
  }, []);

  function toggleZh() {
    setShowZhState((v) => {
      setShowZh(!v);
      return !v;
    });
  }

  const current = questions[index];
  const answeredThis = picks.has(index);

  const handleAnswer = useCallback(
    (isCorrect: boolean, option: QuizOption) => {
      if (!current) return;
      setPicks((prev) => new Map(prev).set(index, option));
      if (!recordedRef.current.has(index)) {
        recordedRef.current.add(index);
        void recordQuizAnswer(current.id, isCorrect);
      }
    },
    [index, current],
  );

  const next = useCallback(() => setIndex((i) => i + 1), []);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Done screen
  if (!current) {
    const correctCount = [...picks.values()].filter((o) => o.correct).length;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
        <p className="text-2xl">{t("practiceDone")}</p>
        <p className="text-sm text-zinc-500">
          {t("score", { correct: correctCount, total: questions.length })}
        </p>
        <button
          type="button"
          onClick={onExit}
          className="mt-2 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-5 py-2.5 text-sm font-medium"
        >
          {t("backToHome")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onExit}
          className="text-sm text-zinc-500 hover:underline underline-offset-4"
        >
          ← {t("exit")}
        </button>
        <div className="flex items-center gap-3">
          <ZhToggle on={showZh} onToggle={toggleZh} />
          <span className="text-sm text-zinc-500 tabular-nums">
            {t("progress", { current: index + 1, total: questions.length })}
          </span>
        </div>
      </header>

      <QuizCard
        key={current.id}
        question={current}
        immediate
        showZh={showZh}
        initialPicked={picks.get(index) ?? null}
        onAnswer={handleAnswer}
      />

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={prev}
          disabled={index === 0}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 py-3 font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("prevQuestion")}
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!answeredThis}
          className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 py-3 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {index + 1 === questions.length ? t("finish") : t("nextQuestion")}
        </button>
      </div>
    </div>
  );
}
