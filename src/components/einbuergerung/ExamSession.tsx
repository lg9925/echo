"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { recordQuizAnswer, setQuizStarred } from "@/lib/db";
import {
  EXAM_PASS_MARK,
  buildExam,
  correctOption,
} from "@/lib/einbuergerung/exam";
import { getShowZh, setShowZh } from "@/lib/einbuergerung/prefs";
import { QuizCard } from "./QuizCard";
import { ZhToggle } from "./ZhToggle";
import type { QuizOption, QuizQuestion } from "@/lib/types";

interface Answer {
  question: QuizQuestion;
  picked: QuizOption;
}

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Mock exam: draw 33 questions (30 national + 3 NRW), one at a time with NO
 * feedback, timed; grade at submit (pass ≥17) and list the wrong answers with
 * the correct option + memory hint. Answers also fold into quizProgress so exam
 * mistakes feed the 只练错题 pool.
 */
export function ExamSession({
  questions,
  onExit,
  onRetryWrong,
  initialStarredIds,
}: {
  questions: QuizQuestion[];
  onExit: () => void;
  /** 交卷后「立即再练错题」— hand this exam's misses to a wrong-loop practice. */
  onRetryWrong?: (qs: QuizQuestion[]) => void;
  /** Question ids already 标记复习, so the review list shows the star state. */
  initialStarredIds?: Set<number>;
}) {
  const t = useTranslations("einbuergerung");
  const exam = useMemo(() => buildExam(questions), [questions]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showZh, setShowZhState] = useState(false);
  const recordedRef = useRef(false);
  // Live 标记复习 set for the submit-screen review (seeded from the caller).
  const [starred, setStarred] = useState<Set<number>>(
    () => new Set(initialStarredIds),
  );

  const toggleStar = useCallback((questionId: number) => {
    setStarred((prev) => {
      const nextOn = !prev.has(questionId);
      const nextSet = new Set(prev);
      if (nextOn) nextSet.add(questionId);
      else nextSet.delete(questionId);
      void setQuizStarred(questionId, nextOn ? 1 : 0);
      return nextSet;
    });
  }, []);

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

  // Count-up timer; freezes on submit.
  useEffect(() => {
    if (submitted) return;
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [submitted]);

  const current = exam[index];
  const isLast = index + 1 >= exam.length;
  const answeredThis = answers.length > index;

  function handleAnswer(_isCorrect: boolean, option: QuizOption) {
    if (recordedRef.current || !current) return;
    recordedRef.current = true;
    setAnswers((a) => [...a, { question: current, picked: option }]);
    void recordQuizAnswer(current.id, option.correct);
  }

  function advance() {
    recordedRef.current = false;
    if (isLast) {
      setSubmitted(true);
    } else {
      setIndex((i) => i + 1);
    }
  }

  if (submitted) {
    const correctCount = answers.filter((a) => a.picked.correct).length;
    const passed = correctCount >= EXAM_PASS_MARK;
    const wrong = answers.filter((a) => !a.picked.correct);
    return (
      <div className="flex flex-1 flex-col gap-6">
        <div
          className={`rounded-xl border p-6 text-center space-y-2 ${
            passed
              ? "border-green-500 bg-green-50 dark:bg-green-900/20"
              : "border-red-500 bg-red-50 dark:bg-red-900/20"
          }`}
        >
          <p className="text-2xl font-semibold">
            {passed ? t("examPass") : t("examFail")}
          </p>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("examScore", {
              correct: correctCount,
              total: exam.length,
              pass: EXAM_PASS_MARK,
            })}
          </p>
          <p className="text-sm text-zinc-500">
            {t("examTime", { time: formatTime(elapsed) })}
          </p>
        </div>

        {wrong.length === 0 ? (
          <p className="text-center text-sm text-zinc-500">{t("examNoWrong")}</p>
        ) : (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("examWrongTitle", { n: wrong.length })}
            </h2>
            <ul className="space-y-3">
              {wrong.map((a) => {
                const right = correctOption(a.question);
                return (
                  <li
                    key={a.question.id}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-2"
                  >
                    <p className="font-medium">{a.question.question_de}</p>
                    <p className="text-sm text-zinc-500">
                      {a.question.question_zh}
                    </p>
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {t("examYourAnswer")}: {a.picked.de}
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-400">
                      {t("examCorrectAnswer")}: {right.de}
                      <span className="text-zinc-500"> · {right.zh}</span>
                    </p>
                    {a.question.study?.hint_zh && (
                      <p className="text-xs text-zinc-500">
                        💡 {a.question.study.hint_zh}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleStar(a.question.id)}
                      aria-pressed={starred.has(a.question.id)}
                      className={`mt-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        starred.has(a.question.id)
                          ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
                          : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      }`}
                    >
                      {starred.has(a.question.id)
                        ? `⭐ ${t("markedButton")}`
                        : `☆ ${t("markButton")}`}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="flex flex-col gap-3">
          {onRetryWrong && wrong.length > 0 && (
            <button
              type="button"
              onClick={() => onRetryWrong(wrong.map((a) => a.question))}
              className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 py-3 font-medium"
            >
              {t("retryWrongNow", { n: wrong.length })}
            </button>
          )}
          <button
            type="button"
            onClick={onExit}
            className={
              onRetryWrong && wrong.length > 0
                ? "rounded-lg border border-zinc-300 dark:border-zinc-700 py-3 font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                : "rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 py-3 font-medium"
            }
          >
            {t("backToHome")}
          </button>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-zinc-500">{t("loadError")}</p>
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
          <span className="text-sm text-zinc-500 tabular-nums">⏱ {formatTime(elapsed)}</span>
          <span className="text-sm text-zinc-500 tabular-nums">
            {t("progress", { current: index + 1, total: exam.length })}
          </span>
        </div>
      </header>

      <QuizCard
        key={current.id}
        question={current}
        immediate={false}
        showZh={showZh}
        onAnswer={handleAnswer}
      />

      <button
        type="button"
        onClick={advance}
        disabled={!answeredThis}
        className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 py-3 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isLast ? t("examSubmit") : t("nextQuestion")}
      </button>
    </div>
  );
}
