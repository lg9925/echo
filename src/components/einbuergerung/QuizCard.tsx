"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getQuizProgress, setQuizStar } from "@/lib/db";
import { speak } from "@/lib/tts";
import { targetBcp47 } from "@/lib/lang";
import { shuffle } from "@/lib/einbuergerung/exam";
import { TargetTokenized } from "../TargetTokenized";
import type { QuizOption, QuizQuestion } from "@/lib/types";

/**
 * One citizenship-test question. Options are shuffled on mount (correctness is
 * read from `option.correct`, never from position). In `immediate` mode (the
 * practice flow) tapping an option reveals right/wrong + the memory hint; in
 * deferred mode (mock exam) the choice is recorded silently and graded later.
 *
 * German is primary and tappable word-by-word for pronunciation; the Chinese
 * translation is hidden by default (active recall) and revealed on tap, or
 * automatically once the question is answered in practice. `showZh` is the
 * persisted global default supplied by the session.
 *
 * Remount with `key={question.id}` to reset selection for the next question.
 */
export function QuizCard({
  question,
  immediate,
  showZh,
  onAnswer,
}: {
  question: QuizQuestion;
  /** true = practice (instant feedback); false = exam (no feedback). */
  immediate: boolean;
  /** Persisted default for showing the Chinese translation. */
  showZh: boolean;
  /** Fired once, the first time the user picks an option. */
  onAnswer: (isCorrect: boolean, option: QuizOption) => void;
}) {
  const t = useTranslations("einbuergerung");
  const options = useMemo(() => shuffle(question.options), [question.options]);
  const [picked, setPicked] = useState<QuizOption | null>(null);
  const [tappedReveal, setTappedReveal] = useState(false);
  const [starred, setStarred] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getQuizProgress(question.id).then((p) => {
      if (!cancelled) setStarred(p?.starred === 1);
    });
    return () => {
      cancelled = true;
    };
  }, [question.id]);

  function toggleStar() {
    const next = !starred;
    setStarred(next);
    void setQuizStar(question.id, next);
  }

  const answered = picked !== null;
  const targetLang = targetBcp47("de");
  // Chinese is visible if the global default is on, the user tapped to reveal,
  // or (in practice) the question has been answered.
  const zhVisible = showZh || tappedReveal || (immediate && answered);

  function choose(opt: QuizOption) {
    if (answered) return;
    setPicked(opt);
    onAnswer(opt.correct, opt);
  }

  const sayWord = (word: string) => void speak(word, { lang: targetLang });

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-5 bg-white dark:bg-zinc-950">
      {/* tags / region badges + collect-to-study-list star */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {question.region === "nrw" && (
            <span className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 text-xs">
              {t("nrwBadge")}
            </span>
          )}
          {question.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 px-2 py-0.5 text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleStar}
          aria-pressed={starred}
          aria-label={t(starred ? "unstar" : "star")}
          title={t(starred ? "unstar" : "star")}
          className={`shrink-0 text-lg leading-none ${
            starred ? "text-amber-500" : "text-zinc-300 dark:text-zinc-600 hover:text-amber-400"
          }`}
        >
          {starred ? "★" : "☆"}
        </button>
      </div>

      {/* question — German tappable word-by-word, whole-question speaker */}
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <TargetTokenized
              target={question.question_de}
              onTapWord={sayWord}
              className="text-xl font-medium leading-snug"
            />
          </div>
          <button
            type="button"
            aria-label={t("playAudio")}
            onClick={() => void speak(question.question_de, { lang: targetLang })}
            className="shrink-0 rounded-full border border-zinc-300 dark:border-zinc-700 w-9 h-9 flex items-center justify-center text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            🔊
          </button>
        </div>
        {zhVisible ? (
          <>
            <p className="text-sm text-zinc-500">{question.question_zh}</p>
            {question.literal && (
              <p className="text-xs text-zinc-400 leading-relaxed">
                {question.literal}
              </p>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setTappedReveal(true)}
            className="text-xs text-zinc-400 underline decoration-dotted underline-offset-4 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {t("showChinese")}
          </button>
        )}
      </div>

      {/* image questions */}
      {question.image && (
        // Remote URL; static export means no next/image loader.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={question.image}
          alt={t("imageAlt")}
          className="max-h-64 w-auto rounded-lg border border-zinc-200 dark:border-zinc-800"
        />
      )}

      {/* options */}
      <ul className="space-y-2">
        {options.map((opt, i) => {
          const isPicked = picked === opt;
          const showState = immediate && answered;
          let cls =
            "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900";
          if (showState && opt.correct) {
            cls =
              "border-green-500 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200";
          } else if (showState && isPicked && !opt.correct) {
            cls =
              "border-red-500 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200";
          } else if (!immediate && isPicked) {
            cls = "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900";
          }
          return (
            <li key={i} className="flex items-stretch gap-2">
              <button
                type="button"
                disabled={answered}
                onClick={() => choose(opt)}
                className={`flex-1 text-left rounded-lg border px-4 py-3 transition-colors disabled:cursor-default ${cls}`}
              >
                <span className="block">{opt.de}</span>
                {zhVisible && (
                  <span className="block text-xs text-zinc-500 mt-0.5">
                    {opt.zh}
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-label={t("playAudio")}
                onClick={() => void speak(opt.de, { lang: targetLang })}
                className="shrink-0 w-11 rounded-lg border border-zinc-300 dark:border-zinc-700 flex items-center justify-center text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                🔊
              </button>
            </li>
          );
        })}
      </ul>

      {/* memory hint, after answering in practice */}
      {immediate && answered && question.study?.hint_zh && (
        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3">
          <p className="text-xs text-zinc-500 mb-1">{t("hintLabel")}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {question.study.hint_zh}
          </p>
        </div>
      )}
    </section>
  );
}
