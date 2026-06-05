"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { listQuizQuestions } from "@/lib/db";
import { ensureEinbuergerungLoaded } from "@/lib/einbuergerung/loader";
import { PracticeSession } from "./PracticeSession";
import type { QuizQuestion } from "@/lib/types";

type View = "home" | "practice";

/**
 * Landing for the 入籍考试 module. Loads (idempotently) the 310-question bank on
 * mount, then offers practice. Filters (Step 3) and the mock exam (Step 4) plug
 * in here later.
 */
export function EinbuergerungHome({ uiLocale }: { uiLocale: string }) {
  const t = useTranslations("einbuergerung");
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [view, setView] = useState<View>("home");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureEinbuergerungLoaded();
        const qs = await listQuizQuestions();
        if (!cancelled) setQuestions(qs);
      } catch (err) {
        console.error(err);
        if (!cancelled) setQuestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

      {view === "home" && (
        <>
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-zinc-500">{t("subtitle")}</p>
          </div>

          {questions === null ? (
            <p className="text-sm text-zinc-500">{t("loading")}</p>
          ) : questions.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("loadError")}</p>
          ) : (
            <section className="space-y-3">
              <button
                type="button"
                onClick={() => setView("practice")}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <p className="text-lg font-medium">{t("practiceAll")}</p>
                <p className="text-sm text-zinc-500 mt-0.5">
                  {t("questionCount", { n: questions.length })}
                </p>
              </button>
            </section>
          )}
        </>
      )}

      {view === "practice" && questions && (
        <PracticeSession questions={questions} onExit={() => setView("home")} />
      )}
    </main>
  );
}
