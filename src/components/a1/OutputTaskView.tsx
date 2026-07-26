"use client";

// M5 每日产出任务: answer today's question / write the ~30-word message,
// self-check the 3 coverage points, submit for explicit LLM correction
// (async job — production routes to claude-cli, minutes not seconds; the UI
// says so honestly and polling survives reload). Offline: self-check alone
// completes the MVD output leg; the draft stays submittable later (补交).

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ensureTodayDraft,
  resumeDraft,
  processDraft,
  saveAttempt,
  saveSelfCheck,
  templateById,
} from "@/lib/outputTask";
import { logActivity } from "@/lib/studyLog";
import { getApiToken } from "@/lib/settings";
import { targetBcp47 } from "@/lib/lang";
import type { OutputDraft } from "@/lib/types";
import { MicButton } from "../MicButton";

export function OutputTaskView({
  language,
  uiLocale,
}: {
  language: string;
  uiLocale: string;
}) {
  const t = useTranslations("a1");
  const [draft, setDraft] = useState<OutputDraft | null>(null);
  const [attempt, setAttempt] = useState("");
  const [busy, setBusy] = useState(false);
  // 0 until the load effect stamps it.
  const startedAtRef = useRef(0);
  const outputLoggedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    startedAtRef.current = Date.now();
    (async () => {
      try {
        const d = await ensureTodayDraft(language);
        if (cancelled) return;
        setDraft(d);
        setAttempt(d.attempt);
        outputLoggedRef.current =
          d.status === "submitted" || d.status === "reviewed";
        // A job submitted before a reload → resume polling it.
        if (d.status === "submitted") {
          void resumeDraft(d, (next) => {
            if (!cancelled) setDraft(next);
          });
        }
      } catch (err) {
        console.error(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language]);

  const template = draft ? templateById(draft.templateId) : undefined;

  // One output unit per day, logged the first time the learner completes the
  // task (submit online, or full self-check offline).
  const logOutputOnce = useCallback(async () => {
    if (outputLoggedRef.current) return;
    outputLoggedRef.current = true;
    await logActivity({
      language,
      source: "outputTask",
      durationMs: Date.now() - startedAtRef.current,
      units: 1,
    });
  }, [language]);

  const submit = useCallback(async () => {
    if (!draft || busy || !attempt.trim()) return;
    setBusy(true);
    try {
      const saved = await saveAttempt(draft, attempt.trim());
      await logOutputOnce();
      await processDraft(saved, setDraft);
    } finally {
      setBusy(false);
    }
  }, [draft, busy, attempt, logOutputOnce]);

  const toggleSelfCheck = useCallback(
    async (i: number) => {
      if (!draft || !template) return;
      const ticks = [...(draft.selfCheck ?? template.coveragePoints.map(() => false))];
      ticks[i] = !ticks[i];
      const next = await saveSelfCheck(draft, ticks);
      setDraft(next);
      if (ticks.every(Boolean)) await logOutputOnce();
    },
    [draft, template, logOutputOnce],
  );

  if (!draft || !template) {
    return (
      <main className="p-6">
        <p className="text-sm text-zinc-500">{t("loading")}</p>
      </main>
    );
  }

  const online =
    typeof navigator !== "undefined" && navigator.onLine && !!getApiToken();
  const ticks = draft.selfCheck ?? template.coveragePoints.map(() => false);
  const result = draft.result;

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 max-w-2xl mx-auto w-full">
      <header className="flex items-center justify-between gap-3">
        <a
          href={`/${uiLocale}/a1/`}
          className="text-sm text-zinc-500 hover:underline underline-offset-4 shrink-0"
        >
          ← {t("title")}
        </a>
        <span className="text-sm text-zinc-500">
          {template.kind === "question" ? t("outputKindQuestion") : t("outputKindMessage")}
        </span>
      </header>

      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-5 bg-white dark:bg-zinc-950">
        <div>
          <p className="text-xs text-zinc-500 mb-1">{t("outputTaskLabel")}</p>
          <p className="text-xl font-medium">{template.prompt.de}</p>
          <p className="text-sm text-zinc-500 mt-1">{template.prompt.zh}</p>
        </div>

        <div>
          <p className="text-xs text-zinc-500 mb-2">{t("outputPointsLabel")}</p>
          <ul className="space-y-1.5">
            {template.coveragePoints.map((p, i) => {
              const covered = result ? result.coverage[i] : undefined;
              return (
                <li key={i} className="flex items-center gap-2 text-sm">
                  {result ? (
                    <span>{covered ? "✅" : "❌"}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void toggleSelfCheck(i)}
                      className="text-base"
                      aria-pressed={ticks[i]}
                    >
                      {ticks[i] ? "✅" : "⬜"}
                    </button>
                  )}
                  <span>{p.zh}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {draft.status === "reviewed" && result ? (
          <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-4">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  result.verdict === "pass"
                    ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200"
                    : result.verdict === "partial"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200"
                      : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
                }`}
              >
                {result.verdict === "pass"
                  ? t("outputPass")
                  : result.verdict === "partial"
                    ? t("outputPartial")
                    : t("outputFail")}
              </span>
              {result.corrections.length > 0 && (
                <span className="text-xs text-zinc-500">{t("outputCardsAdded")}</span>
              )}
            </div>

            <div>
              <p className="text-xs text-zinc-500 mb-1">{t("yourAnswerLabel")}</p>
              <p className="text-base whitespace-pre-wrap">{draft.attempt}</p>
            </div>

            {result.corrections.length > 0 && (
              <div>
                <p className="text-xs text-zinc-500 mb-2">{t("outputCorrections")}</p>
                <ul className="space-y-2">
                  {result.corrections.map((c, i) => (
                    <li key={i} className="text-sm rounded-lg bg-zinc-50 dark:bg-zinc-900 p-3">
                      <p>
                        <span className="text-red-600 dark:text-red-400 line-through">{c.original}</span>
                        {" → "}
                        <span className="font-medium">{c.corrected}</span>
                      </p>
                      <p className="text-zinc-600 dark:text-zinc-400 mt-0.5">{c.explanation}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.revised && (
              <div>
                <p className="text-xs text-zinc-500 mb-1">{t("outputRevised")}</p>
                <p className="text-base whitespace-pre-wrap">{result.revised}</p>
              </div>
            )}
            {result.encouragement && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{result.encouragement}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <textarea
                value={attempt}
                onChange={(e) => setAttempt(e.target.value)}
                placeholder={t("outputPlaceholder")}
                rows={4}
                disabled={busy || draft.status === "submitted"}
                className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-base resize-none"
              />
              <MicButton
                lang={targetBcp47(language)}
                onText={(text) => setAttempt((prev) => (prev ? `${prev} ${text}` : text))}
              />
            </div>

            {draft.status === "submitted" ? (
              <p className="text-sm text-zinc-500">{t("outputWaiting")}</p>
            ) : online ? (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || !attempt.trim()}
                className="w-full py-3 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium disabled:opacity-40"
              >
                {busy ? t("outputSubmitting") : t("outputSubmit")}
              </button>
            ) : (
              <p className="text-sm text-zinc-500">{t("outputOffline")}</p>
            )}
            {draft.status === "error" && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {t("outputError")} {draft.error}
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
