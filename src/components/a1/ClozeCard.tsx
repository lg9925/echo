"use client";

// Cloze card: island sentence with a blanked token + audio → type the missing
// word → tolerant-whitespace, case- and umlaut-STRICT match → auto-grade.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { clozeDisplay, clozeMatches } from "@/lib/a1/cloze";
import { speak } from "@/lib/tts";
import { targetBcp47 } from "@/lib/lang";
import type { Grade } from "@/lib/sr";
import type { JudgeErrorTag } from "@/lib/api/contracts";
import type { ClozePayload } from "@/lib/types";

export function ClozeCard({
  payload,
  language,
  onGrade,
}: {
  payload: ClozePayload;
  language: string;
  onGrade: (grade: Grade, errorTags?: JudgeErrorTag[]) => void;
}) {
  const t = useTranslations("a1");
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const [right, setRight] = useState(false);

  const check = () => {
    if (checked || typed.trim().length === 0) return;
    const ok = clozeMatches(payload.answer, typed);
    setRight(ok);
    setChecked(true);
    void speak(payload.target, { lang: targetBcp47(language) });
  };

  const finish = () => {
    onGrade(
      right ? "good" : "again",
      right ? undefined : [{ type: "VOCAB", detail: payload.answer.toLowerCase() }],
    );
  };

  return (
    <>
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-5 bg-white dark:bg-zinc-950 min-h-[280px]">
        <div>
          <p className="text-xs text-zinc-500 mb-1">{t("clozeLabel")}</p>
          <p className="text-2xl font-medium">
            {checked ? payload.target : clozeDisplay(payload.target, payload.clozeIndex)}
          </p>
          {payload.hint && !checked && (
            <p className="text-sm text-zinc-500 mt-1">{payload.hint}</p>
          )}
        </div>

        {checked && (
          <div>
            <p
              className={`text-lg ${
                right
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {typed.trim()} {right ? "✓" : `→ ${payload.answer}`}
            </p>
          </div>
        )}

        {!checked && (
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") check();
            }}
            placeholder={t("clozePlaceholder")}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-lg"
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
