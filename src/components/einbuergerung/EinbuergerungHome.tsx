"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { listAllQuizProgress, listQuizQuestions } from "@/lib/db";
import { ensureEinbuergerungLoaded } from "@/lib/einbuergerung/loader";
import {
  EMPTY_FILTER,
  filterQuestions,
  quizFacets,
  type QuizFilter,
  type QuizStatusFilter,
} from "@/lib/einbuergerung/filters";
import { PracticeSession } from "./PracticeSession";
import type { QuizProgress, QuizQuestion } from "@/lib/types";

type View = "home" | "practice";

/**
 * Landing for the 入籍考试 module: idempotently loads the 310-question bank,
 * lets the learner filter (批次 / 主题 / 标签 / 错题) and start practice. The
 * mock exam (Step 4) plugs in here later.
 */
export function EinbuergerungHome({ uiLocale }: { uiLocale: string }) {
  const t = useTranslations("einbuergerung");
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [progressById, setProgressById] = useState<Map<number, QuizProgress>>(
    new Map(),
  );
  const [filter, setFilter] = useState<QuizFilter>(EMPTY_FILTER);
  const [view, setView] = useState<View>("home");

  const loadProgress = useCallback(async () => {
    const all = await listAllQuizProgress();
    setProgressById(new Map(all.map((p) => [p.questionId, p])));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureEinbuergerungLoaded();
        const qs = await listQuizQuestions();
        const prog = await listAllQuizProgress();
        if (!cancelled) {
          setQuestions(qs);
          setProgressById(new Map(prog.map((p) => [p.questionId, p])));
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setQuestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const facets = useMemo(
    () => quizFacets(questions ?? []),
    [questions],
  );
  const matches = useMemo(
    () => filterQuestions(questions ?? [], filter, progressById),
    [questions, filter, progressById],
  );

  function exitPractice() {
    setView("home");
    void loadProgress(); // refresh so 只练错题 counts reflect this round
  }

  function toggleTag(tag: string) {
    setFilter((f) => ({
      ...f,
      tags: f.tags.includes(tag)
        ? f.tags.filter((x) => x !== tag)
        : [...f.tags, tag],
    }));
  }

  if (view === "practice") {
    return (
      <main className="flex flex-1 flex-col gap-6 px-6 py-12 max-w-2xl mx-auto w-full">
        <PracticeSession questions={matches} onExit={exitPractice} />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-12 max-w-2xl mx-auto w-full">
      <header className="flex items-baseline justify-between">
        <a
          href={`/${uiLocale}/de/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          ← {t("back")}
        </a>
      </header>

      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-zinc-500">{t("subtitle")}</p>
      </div>

      {questions === null ? (
        <p className="text-sm text-zinc-500">{t("loading")}</p>
      ) : questions.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("loadError")}</p>
      ) : (
        <>
          <section className="space-y-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("filterTitle")}
            </h2>

            {/* 批次 day */}
            <Field label={t("filterDay")}>
              <Chip
                active={filter.day === null}
                onClick={() => setFilter((f) => ({ ...f, day: null }))}
              >
                {t("filterAll")}
              </Chip>
              {facets.days.map((d) => (
                <Chip
                  key={d}
                  active={filter.day === d}
                  onClick={() => setFilter((f) => ({ ...f, day: d }))}
                >
                  {t("dayLabel", { n: d })}
                </Chip>
              ))}
            </Field>

            {/* 技巧标签 tags */}
            {facets.tags.length > 0 && (
              <Field label={t("filterTags")}>
                {facets.tags.map((tag) => (
                  <Chip
                    key={tag}
                    active={filter.tags.includes(tag)}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </Chip>
                ))}
              </Field>
            )}

            {/* 状态 status */}
            <Field label={t("filterStatus")}>
              {(["all", "wrong", "unseen"] as QuizStatusFilter[]).map((s) => (
                <Chip
                  key={s}
                  active={filter.status === s}
                  onClick={() => setFilter((f) => ({ ...f, status: s }))}
                >
                  {t(`status_${s}`)}
                </Chip>
              ))}
            </Field>

            {/* 主题 category (long list → dropdown) */}
            <Field label={t("filterCategory")}>
              <select
                value={filter.category ?? ""}
                onChange={(e) =>
                  setFilter((f) => ({
                    ...f,
                    category: e.target.value || null,
                  }))
                }
                className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm w-full"
              >
                <option value="">{t("filterAllCategories")}</option>
                {facets.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-zinc-500">
              {t("matchCount", { n: matches.length })}
            </span>
            <button
              type="button"
              disabled={matches.length === 0}
              onClick={() => setView("practice")}
              className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-6 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("startPractice")}
            </button>
          </div>
        </>
      )}
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-zinc-500">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm border transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
          : "border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
      }`}
    >
      {children}
    </button>
  );
}
