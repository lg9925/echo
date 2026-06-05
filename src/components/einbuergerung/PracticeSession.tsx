"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { recordQuizAnswer } from "@/lib/db";
import { getShowZh, setShowZh } from "@/lib/einbuergerung/prefs";
import { QuizCard } from "./QuizCard";
import { ZhToggle } from "./ZhToggle";
import type { QuizQuestion } from "@/lib/types";

/**
 * Practice flow over a (pre-filtered) list of questions: instant feedback per
 * card, progress folded into quizProgress, score at the end. No timer, no pass
 * line — that's the mock-exam flow.
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
  const [correctCount, setCorrectCount] = useState(0);
  const [answeredThis, setAnsweredThis] = useState(false);
  const [showZh, setShowZhState] = useState(false);
  // Guard against double-recording if onAnswer somehow fires twice.
  const recordedRef = useRef(false);

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

  const handleAnswer = useCallback(
    (isCorrect: boolean) => {
      if (recordedRef.current || !current) return;
      recordedRef.current = true;
      setAnsweredThis(true);
      if (isCorrect) setCorrectCount((c) => c + 1);
      void recordQuizAnswer(current.id, isCorrect);
    },
    [current],
  );

  const next = useCallback(() => {
    recordedRef.current = false;
    setAnsweredThis(false);
    setIndex((i) => i + 1);
  }, []);

  // Done screen
  if (!current) {
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
        onAnswer={handleAnswer}
      />

      <button
        type="button"
        onClick={next}
        disabled={!answeredThis}
        className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 py-3 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {index + 1 === questions.length ? t("finish") : t("nextQuestion")}
      </button>
    </div>
  );
}
