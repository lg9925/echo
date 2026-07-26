"use client";

// M6 口语栈: 跟读 → 复述 → 4/3/2. Pick an island, (optionally shadow it
// first), then retell the same content in three shrinking time boxes
// (90/60/45 s — fluency pressure). Feedback comes ONLY after the last round
// (protect fluency during rounds 1–2): the final transcript goes through the
// existing output_feedback task; corrections land as SRS error cards
// (source "speaking"). NO pronunciation scoring anywhere — feedback is about
// content/grammar from the transcript, never a score on the audio.
// Degradation: no STT → timed self-practice only; offline → no LLM feedback.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { listIslands, listSentencesByIsland } from "@/lib/db";
import { ensureSeedLoaded } from "@/lib/seedLoader";
import { runJob } from "@/lib/api/client";
import { profileForRequest } from "@/lib/profile";
import { getApiToken } from "@/lib/settings";
import {
  isDictationSupported,
  startDictation,
  type DictationHandle,
} from "@/lib/speech";
import { createErrorCard } from "@/lib/a1/errorCards";
import { logActivity } from "@/lib/studyLog";
import { targetBcp47 } from "@/lib/lang";
import type {
  OutputFeedbackRequest,
  OutputFeedbackResult,
  TargetLanguage,
} from "@/lib/api/contracts";
import type { Island, Sentence } from "@/lib/types";

const ROUND_SECONDS = [90, 60, 45] as const;

type Phase = "pick" | "brief" | "retell" | "between" | "feedback";

export function SpeakingTutor({
  language,
  uiLocale,
}: {
  language: string;
  uiLocale: string;
}) {
  const t = useTranslations("a1");
  const [islands, setIslands] = useState<Island[] | null>(null);
  const [island, setIsland] = useState<Island | null>(null);
  const [points, setPoints] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("pick");
  const [round, setRound] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [sttOk, setSttOk] = useState(false);
  const [feedback, setFeedback] = useState<OutputFeedbackResult | null>(null);
  const [feedbackState, setFeedbackState] = useState<"idle" | "waiting" | "error" | "offline">("idle");
  const dictationRef = useRef<DictationHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalsRef = useRef("");
  const sessionStartRef = useRef(0);
  const bcp47 = targetBcp47(language);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot feature detection after mount
    setSttOk(isDictationSupported());
    (async () => {
      try {
        await ensureSeedLoaded(language);
        const list = await listIslands(language);
        if (!cancelled) setIslands(list);
      } catch (err) {
        console.error(err);
        if (!cancelled) setIslands([]);
      }
    })();
    return () => {
      cancelled = true;
      dictationRef.current?.abort();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [language]);

  const pickIsland = useCallback(
    async (i: Island) => {
      const sentences = await listSentencesByIsland(i.id);
      if (sentences.length === 0) return;
      // 3 evenly-spaced sentences' natives = the retell's content points.
      const idxs =
        sentences.length < 3
          ? sentences.map((_: Sentence, k: number) => k)
          : [0, Math.floor(sentences.length / 2), sentences.length - 1];
      setPoints(idxs.map((k) => sentences[k]!.native));
      setIsland(i);
      setPhase("brief");
      sessionStartRef.current = Date.now();
    },
    [],
  );

  const stopRound = useCallback(() => {
    dictationRef.current?.stop();
    dictationRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const endRound = useCallback(() => {
    stopRound();
    setInterim("");
    if (round + 1 < ROUND_SECONDS.length) {
      setPhase("between");
    } else {
      setPhase("feedback");
    }
  }, [stopRound, round]);

  const endRoundRef = useRef(endRound);
  useEffect(() => {
    endRoundRef.current = endRound;
  }, [endRound]);

  const startRound = useCallback(
    (roundIdx: number) => {
      setRound(roundIdx);
      setPhase("retell");
      setSecondsLeft(ROUND_SECONDS[roundIdx]!);
      // Only the LAST round's transcript goes to feedback — clear accumulators.
      finalsRef.current = "";
      setTranscript("");
      setInterim("");
      if (sttOk) {
        dictationRef.current = startDictation({
          lang: bcp47,
          continuous: true,
          onResult: (text, isFinal) => {
            if (isFinal) {
              finalsRef.current = `${finalsRef.current} ${text}`.trim();
              setTranscript(finalsRef.current);
              setInterim("");
            } else {
              setInterim(text);
            }
          },
          onEnd: () => {
            // Chrome sometimes ends continuous sessions early — restart while
            // the round clock is still running.
            if (timerRef.current && dictationRef.current) {
              dictationRef.current = startDictation({
                lang: bcp47,
                continuous: true,
                onResult: (text, isFinal) => {
                  if (isFinal) {
                    finalsRef.current = `${finalsRef.current} ${text}`.trim();
                    setTranscript(finalsRef.current);
                    setInterim("");
                  } else {
                    setInterim(text);
                  }
                },
              });
            }
          },
        });
      }
      timerRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            endRoundRef.current();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    },
    [sttOk, bcp47],
  );

  const online =
    typeof navigator !== "undefined" && navigator.onLine && !!getApiToken();

  const requestFeedback = useCallback(async () => {
    if (!island) return;
    const text = finalsRef.current.trim();
    await logActivity({
      language,
      source: "speaking",
      durationMs: Date.now() - sessionStartRef.current,
      units: 1,
    });
    if (!online || !sttOk || !text) {
      setFeedbackState("offline");
      return;
    }
    setFeedbackState("waiting");
    try {
      const req: OutputFeedbackRequest = {
        language: language as TargetLanguage,
        taskPrompt: `Erzählen Sie frei: ${island.name}`,
        coveragePoints: points.map((p) => `提到:${p}`),
        attempt: text,
        profile: profileForRequest(language),
      };
      const result = await runJob<OutputFeedbackResult>("output_feedback", req);
      setFeedback(result);
      setFeedbackState("idle");
      for (const c of result.corrections) {
        const corrected = c.corrected.trim();
        if (!corrected) continue;
        await createErrorCard({
          language,
          source: "speaking",
          text: corrected,
          mode: "sentence",
          errorTags: [c.errorTag],
        });
      }
    } catch (err) {
      console.error(err);
      setFeedbackState("error");
    }
  }, [island, language, points, online, sttOk]);

  useEffect(() => {
    if (phase === "feedback" && feedbackState === "idle" && !feedback) {
      void requestFeedback();
    }
  }, [phase, feedbackState, feedback, requestFeedback]);

  // ---- island picker ----
  if (phase === "pick") {
    return (
      <main className="flex flex-1 flex-col gap-6 px-4 py-6 max-w-2xl mx-auto w-full">
        <header>
          <a
            href={`/${uiLocale}/a1/`}
            className="text-sm text-zinc-500 hover:underline underline-offset-4"
          >
            ← {t("title")}
          </a>
        </header>
        <h1 className="text-xl font-semibold">{t("speakingTitle")}</h1>
        <p className="text-sm text-zinc-500">{t("speakingIntro")}</p>
        {!sttOk && (
          <p className="rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 text-sm px-4 py-3">
            {t("speakingNoStt")}
          </p>
        )}
        <section className="space-y-2">
          {islands === null ? (
            <p className="text-sm text-zinc-500">{t("loading")}</p>
          ) : (
            islands.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => void pickIsland(i)}
                className="w-full rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                {i.name}
              </button>
            ))
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-6 px-4 py-6 max-w-2xl mx-auto w-full">
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            stopRound();
            setPhase("pick");
            setFeedback(null);
            setFeedbackState("idle");
          }}
          className="text-sm text-zinc-500 hover:underline underline-offset-4"
        >
          ← {island?.name}
        </button>
        {phase === "retell" && (
          <span className="text-2xl font-semibold tabular-nums">{secondsLeft}s</span>
        )}
      </header>

      {/* Content points stay visible through every phase. */}
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950">
        <p className="text-xs text-zinc-500 mb-2">{t("speakingPoints")}</p>
        <ul className="space-y-1 text-sm">
          {points.map((p, i) => (
            <li key={i}>· {p}</li>
          ))}
        </ul>
      </section>

      {phase === "brief" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("speakingBrief")}</p>
          <div className="flex gap-3">
            <a
              href={
                island && /\.u\./.test(island.id)
                  ? `/${uiLocale}/island/?id=${island.id}`
                  : `/${uiLocale}/shadow/${island?.id}/`
              }
              className="px-4 py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm font-medium"
            >
              {t("speakingShadowFirst")}
            </a>
            <button
              type="button"
              onClick={() => startRound(0)}
              className="flex-1 py-3 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium"
            >
              {t("speakingStart", { seconds: ROUND_SECONDS[0] })}
            </button>
          </div>
        </div>
      )}

      {phase === "retell" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-500">
            {t("speakingRound", { n: round + 1, total: ROUND_SECONDS.length })}
          </p>
          {sttOk && (
            <p className="min-h-[80px] rounded-lg bg-zinc-50 dark:bg-zinc-900 p-3 text-base">
              {transcript} <span className="text-zinc-400">{interim}</span>
            </p>
          )}
          <button
            type="button"
            onClick={endRound}
            className="w-full py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 font-medium"
          >
            {t("speakingDoneEarly")}
          </button>
        </div>
      )}

      {phase === "between" && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("speakingBetween", { seconds: ROUND_SECONDS[round + 1] ?? 0 })}
          </p>
          <button
            type="button"
            onClick={() => startRound(round + 1)}
            className="w-full py-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium"
          >
            {t("speakingNextRound")}
          </button>
        </div>
      )}

      {phase === "feedback" && (
        <div className="space-y-4">
          {feedbackState === "waiting" && (
            <p className="text-sm text-zinc-500">{t("outputWaiting")}</p>
          )}
          {feedbackState === "offline" && (
            <p className="text-sm text-zinc-500">{t("speakingNoFeedback")}</p>
          )}
          {feedbackState === "error" && (
            <p className="text-sm text-red-600 dark:text-red-400">{t("outputError")}</p>
          )}
          {feedback && (
            <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950 space-y-4">
              {transcript && (
                <div>
                  <p className="text-xs text-zinc-500 mb-1">{t("speakingTranscript")}</p>
                  <p className="text-base">{transcript}</p>
                </div>
              )}
              {feedback.corrections.length > 0 && (
                <div>
                  <p className="text-xs text-zinc-500 mb-2">
                    {t("outputCorrections")} · {t("outputCardsAdded")}
                  </p>
                  <ul className="space-y-2">
                    {feedback.corrections.map((c, i) => (
                      <li key={i} className="text-sm rounded-lg bg-zinc-50 dark:bg-zinc-900 p-3">
                        <p>
                          <span className="text-red-600 dark:text-red-400 line-through">
                            {c.original}
                          </span>
                          {" → "}
                          <span className="font-medium">{c.corrected}</span>
                        </p>
                        <p className="text-zinc-600 dark:text-zinc-400 mt-0.5">
                          {c.explanation}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {feedback.revised && (
                <div>
                  <p className="text-xs text-zinc-500 mb-1">{t("outputRevised")}</p>
                  <p className="text-base">{feedback.revised}</p>
                </div>
              )}
              {feedback.encouragement && (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {feedback.encouragement}
                </p>
              )}
            </section>
          )}
          <a
            href={`/${uiLocale}/a1/`}
            className="block text-center py-3 rounded-lg border border-zinc-300 dark:border-zinc-700 font-medium"
          >
            ← {t("title")}
          </a>
        </div>
      )}
    </main>
  );
}
