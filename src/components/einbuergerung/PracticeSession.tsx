"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { recordQuizAnswer, setQuizStarred } from "@/lib/db";
import { correctOption } from "@/lib/einbuergerung/exam";
import { getShowZh, setShowZh } from "@/lib/einbuergerung/prefs";
import { QuizCard } from "./QuizCard";
import { ZhToggle } from "./ZhToggle";
import type { QuizOption, QuizQuestion } from "@/lib/types";

/**
 * Practice flow over a (pre-filtered) list of questions: instant feedback per
 * card, progress folded into quizProgress, score at the end. Supports back/
 * forward navigation — a question's pick is remembered (and its feedback shown)
 * when you return to it, and it's recorded to quizProgress only once.
 *
 * Optional 错题本/刷题 behaviours (both default off, so the plain filtered
 * practice flow is unchanged):
 * - `requeueWrong`: a wrong answer re-queues the question at the END of this
 *   round, so it keeps coming back until answered correctly (当场重排). The
 *   re-queued copy is a new index → recorded again, so attempts/streak fold
 *   correctly (连对 3 次 = 掌握).
 * - `reviewWrong`: the done screen lists this round's wrong answers with the
 *   correct option + memory hint (same shape as the mock-exam review).
 */
export function PracticeSession({
  questions,
  onExit,
  requeueWrong = false,
  reviewWrong = false,
  initialStarredIds,
}: {
  questions: QuizQuestion[];
  onExit: () => void;
  /** 答错的题追加到队尾,本轮循环到答对为止。 */
  requeueWrong?: boolean;
  /** 结束页列出本轮错题(题干 + 你的选择 + 正确答案 + 记忆提示)。 */
  reviewWrong?: boolean;
  /** Question ids already 标记复习 when the session started, so the card shows
   *  the correct star state. */
  initialStarredIds?: Set<number>;
}) {
  const t = useTranslations("einbuergerung");
  // The rendered sequence. Starts as `questions`; grows at the tail when
  // requeueWrong re-queues a miss — so lengths/progress must read `queue`.
  const [queue, setQueue] = useState<QuizQuestion[]>(questions);
  const [index, setIndex] = useState(0);
  // index → the option the user picked (locks the card, drives the score).
  const [picks, setPicks] = useState<Map<number, QuizOption>>(new Map());
  const [showZh, setShowZhState] = useState(false);
  // Live 标记复习 set for this session (seeded from the caller), so toggling a
  // star updates the card immediately and persists.
  const [starred, setStarred] = useState<Set<number>>(
    () => new Set(initialStarredIds),
  );
  // Indices already written to quizProgress — never double-count an answer.
  const recordedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage read after mount (SSR has no localStorage)
    setShowZhState(getShowZh());
  }, []);

  // Reset the round if the caller swaps in a different question set (defensive:
  // the parent normally remounts us per session).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional full reset when the question set changes
    setQueue(questions);
    setIndex(0);
    setPicks(new Map());
    recordedRef.current = new Set();
  }, [questions]);

  function toggleZh() {
    setShowZhState((v) => {
      setShowZh(!v);
      return !v;
    });
  }

  const current = queue[index];
  const answeredThis = picks.has(index);

  const handleAnswer = useCallback(
    (isCorrect: boolean, option: QuizOption) => {
      if (!current) return;
      setPicks((prev) => new Map(prev).set(index, option));
      if (!recordedRef.current.has(index)) {
        recordedRef.current.add(index);
        void recordQuizAnswer(current.id, isCorrect);
      }
      // 当场重排:答错 → 排到队尾,本轮循环到答对为止。
      if (!isCorrect && requeueWrong) {
        setQueue((q) => [...q, current]);
      }
    },
    [index, current, requeueWrong],
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

  const next = useCallback(() => setIndex((i) => i + 1), []);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Done screen
  if (!current) {
    const correctCount = [...picks.values()].filter((o) => o.correct).length;
    // This round's misses, deduped by question (a re-queued question can be
    // missed more than once — list it once, with the first wrong pick).
    const wrongByQuestion = new Map<number, { q: QuizQuestion; picked: QuizOption }>();
    if (reviewWrong) {
      queue.forEach((q, i) => {
        const picked = picks.get(i);
        if (picked && !picked.correct && !wrongByQuestion.has(q.id)) {
          wrongByQuestion.set(q.id, { q, picked });
        }
      });
    }
    const wrong = [...wrongByQuestion.values()];
    return (
      <div className="flex flex-1 flex-col gap-6 py-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-2xl">{t("practiceDone")}</p>
          <p className="text-sm text-zinc-500">
            {t("score", { correct: correctCount, total: queue.length })}
          </p>
        </div>

        {reviewWrong && wrong.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("roundWrongTitle", { n: wrong.length })}
            </h2>
            <ul className="space-y-3">
              {wrong.map(({ q, picked }) => {
                const right = correctOption(q);
                return (
                  <li
                    key={q.id}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 space-y-2"
                  >
                    <p className="font-medium">{q.question_de}</p>
                    <p className="text-sm text-zinc-500">{q.question_zh}</p>
                    <p className="text-sm text-red-600 dark:text-red-400">
                      {t("examYourAnswer")}: {picked.de}
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-400">
                      {t("examCorrectAnswer")}: {right.de}
                      <span className="text-zinc-500"> · {right.zh}</span>
                    </p>
                    {q.study?.hint_zh && (
                      <p className="text-xs text-zinc-500">
                        💡 {q.study.hint_zh}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <button
          type="button"
          onClick={onExit}
          className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 py-3 font-medium"
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
            {t("progress", { current: index + 1, total: queue.length })}
          </span>
        </div>
      </header>

      <QuizCard
        key={`${current.id}-${index}`}
        question={current}
        immediate
        showZh={showZh}
        initialPicked={picks.get(index) ?? null}
        onAnswer={handleAnswer}
        starred={starred.has(current.id)}
        onToggleStar={() => toggleStar(current.id)}
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
          {index + 1 === queue.length ? t("finish") : t("nextQuestion")}
        </button>
      </div>
    </div>
  );
}
