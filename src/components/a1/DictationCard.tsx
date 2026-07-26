"use client";

// Dictation-error card inside the interleaved session: "re-dictate this" —
// play the audio (text hidden), type it, char-diff verdict. The same exercise
// form that produced the error (承重墙 #3: production trains production).

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { charAccuracy, classifyDictationErrors, diffChars } from "@/lib/a1/charDiff";
import { DIKTAT_ACCURACY_THRESHOLD } from "@/lib/a1/diktat";
import { speak } from "@/lib/tts";
import { targetBcp47 } from "@/lib/lang";
import type { Grade } from "@/lib/sr";
import type { JudgeErrorTag } from "@/lib/api/contracts";
import type { DictationErrorPayload } from "@/lib/types";
import { DiffLine } from "./DiffLine";

export function DictationCard({
  payload,
  language,
  onGrade,
}: {
  payload: DictationErrorPayload;
  language: string;
  onGrade: (grade: Grade, errorTags?: JudgeErrorTag[]) => void;
}) {
  const t = useTranslations("a1");
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const [accuracy, setAccuracy] = useState(0);

  const play = useCallback(() => {
    void speak(payload.text, { lang: targetBcp47(language) });
  }, [payload.text, language]);

  useEffect(() => {
    play();
  }, [play]);

  const check = () => {
    if (checked || typed.trim().length === 0) return;
    setAccuracy(charAccuracy(payload.text, typed));
    setChecked(true);
  };

  const finish = () => {
    const passed = accuracy >= DIKTAT_ACCURACY_THRESHOLD;
    onGrade(
      passed ? "good" : "again",
      passed ? undefined : classifyDictationErrors(payload.text, typed),
    );
  };

  return (
    <>
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-5 bg-white dark:bg-zinc-950 min-h-[280px]">
        <div className="flex items-center gap-3">
          <p className="text-xs text-zinc-500">{t("redictateLabel")}</p>
          <button
            type="button"
            onClick={play}
            className="rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-sm"
          >
            🔊 {t("playAgain")}
          </button>
        </div>

        {checked ? (
          <div className="space-y-2">
            <DiffLine ops={diffChars(payload.text, typed)} />
            <p className="text-sm text-zinc-500 tabular-nums">
              {t("accuracy", { pct: Math.round(accuracy * 100) })}
            </p>
          </div>
        ) : (
          <textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                check();
              }
            }}
            placeholder={t("diktatPlaceholder")}
            rows={2}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-lg resize-none"
          />
        )}
      </section>

      {checked ? (
        <button
          type="button"
          onClick={finish}
          className="py-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium"
        >
          {t("continue")}
        </button>
      ) : (
        <button
          type="button"
          onClick={check}
          disabled={typed.trim().length === 0}
          className="py-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium disabled:opacity-40"
        >
          {t("check")}
        </button>
      )}
    </>
  );
}
