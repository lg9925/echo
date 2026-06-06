"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { listAllQuizProgress, listQuizQuestions } from "@/lib/db";
import { allCachedAudioKeys } from "@/lib/audioCache";
import {
  deleteQuizAudio,
  downloadQuizAudio,
  quizAudioStatus,
} from "@/lib/offlineAudio";
import { ensureEinbuergerungLoaded } from "@/lib/einbuergerung/loader";
import {
  EMPTY_FILTER,
  filterQuestions,
  quizFacets,
  type QuizFilter,
  type QuizStatusFilter,
} from "@/lib/einbuergerung/filters";
import { TAG_HELP_KEY } from "@/lib/einbuergerung/tags";
import { PracticeSession } from "./PracticeSession";
import { ExamSession } from "./ExamSession";
import type { QuizProgress, QuizQuestion } from "@/lib/types";

type View = "home" | "practice" | "exam";

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
  // All cached audio keys, loaded once so per-filter status is a sync in-memory
  // check (not 6 IndexedDB reads per question on every chip tap). Refreshed
  // after a download / delete.
  const [cachedKeys, setCachedKeys] = useState<Set<string>>(new Set());
  // Live clip progress while the current filter's audio downloads.
  const [dlProg, setDlProg] = useState<{ done: number; total: number } | null>(
    null,
  );
  // The set handed to PracticeSession — either the filtered matches or a custom
  // selection (one question / all starred) from the study list.
  const [practiceSet, setPracticeSet] = useState<QuizQuestion[]>([]);

  const loadProgress = useCallback(async () => {
    const all = await listAllQuizProgress();
    setProgressById(new Map(all.map((p) => [p.questionId, p])));
  }, []);

  const refreshCachedKeys = useCallback(async () => {
    setCachedKeys(await allCachedAudioKeys());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureEinbuergerungLoaded();
        const qs = await listQuizQuestions();
        const prog = await listAllQuizProgress();
        const keys = await allCachedAudioKeys();
        if (!cancelled) {
          setQuestions(qs);
          setProgressById(new Map(prog.map((p) => [p.questionId, p])));
          setCachedKeys(keys);
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
  // Offline-audio status for the current filter (sync, in-memory).
  const audioStatus = useMemo(
    () => quizAudioStatus(matches, "de", cachedKeys),
    [matches, cachedKeys],
  );

  async function downloadAudio() {
    setDlProg({ done: 0, total: audioStatus.total });
    const res = await downloadQuizAudio(matches, "de", (done, total) =>
      setDlProg({ done, total }),
    );
    setDlProg(null);
    await refreshCachedKeys();
    if (res.failed > 0) window.alert(t("offlineFailed", { n: res.failed }));
  }

  async function removeAudio() {
    if (!window.confirm(t("confirmDeleteOfflineAudio"))) return;
    await deleteQuizAudio(matches, "de");
    await refreshCachedKeys();
  }

  function exitToHome() {
    setView("home");
    void loadProgress(); // refresh so 只练错题 / 收藏 counts reflect this round
  }

  function startPractice(qs: QuizQuestion[]) {
    setPracticeSet(qs);
    setView("practice");
  }

  function toggleTag(tag: string) {
    setFilter((f) => ({
      ...f,
      tags: f.tags.includes(tag)
        ? f.tags.filter((x) => x !== tag)
        : [...f.tags, tag],
    }));
  }

  function offlineButton() {
    const base =
      "rounded-lg border px-3 py-2.5 text-sm transition-colors disabled:opacity-40";
    if (dlProg) {
      return (
        <span
          className={`${base} border-zinc-200 dark:border-zinc-800 text-zinc-500 tabular-nums`}
        >
          {t("offlineDownloading", { done: dlProg.done, total: dlProg.total })}
        </span>
      );
    }
    if (audioStatus.total === 0) return null;
    const full = audioStatus.cached === audioStatus.total;
    if (full) {
      return (
        <button
          type="button"
          onClick={removeAudio}
          title={t("offlineReady")}
          className={`${base} border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:border-red-300 hover:text-red-500`}
        >
          ⬇✓
        </button>
      );
    }
    const partial = audioStatus.cached > 0;
    return (
      <button
        type="button"
        onClick={downloadAudio}
        title={
          partial
            ? t("offlinePartial", {
                cached: audioStatus.cached,
                total: audioStatus.total,
              })
            : t("offlineDownload")
        }
        className={`${base} border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900`}
      >
        ⬇{" "}
        {partial
          ? `${audioStatus.cached}/${audioStatus.total}`
          : t("offlineDownload")}
      </button>
    );
  }

  if (view === "practice") {
    return (
      <main className="flex flex-1 flex-col gap-6 px-6 py-12 max-w-2xl mx-auto w-full">
        <PracticeSession questions={practiceSet} onExit={exitToHome} />
      </main>
    );
  }

  if (view === "exam" && questions) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-6 py-12 max-w-2xl mx-auto w-full">
        <ExamSession questions={questions} onExit={exitToHome} />
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
          <button
            type="button"
            onClick={() => setView("exam")}
            className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <p className="text-lg font-medium">{t("examTitle")}</p>
            <p className="text-sm text-zinc-500 mt-0.5">{t("examHint")}</p>
          </button>

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

            {/* 技巧标签 tags + 说明 */}
            {facets.tags.length > 0 && (
              <div className="space-y-1.5">
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
                <details className="text-xs">
                  <summary className="cursor-pointer select-none text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                    {t("tagHelpTitle")}
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {facets.tags
                      .filter((tag) => TAG_HELP_KEY[tag])
                      .map((tag) => (
                        <li key={tag} className="text-zinc-500">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">
                            {tag}
                          </span>
                          {" — "}
                          {t(TAG_HELP_KEY[tag]!)}
                        </li>
                      ))}
                  </ul>
                </details>
              </div>
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
            <div className="flex items-center gap-2">
              {offlineButton()}
              <button
                type="button"
                disabled={matches.length === 0}
                onClick={() => startPractice(matches)}
                className="rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-6 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("startPractice")}
              </button>
            </div>
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
