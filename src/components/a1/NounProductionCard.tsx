"use client";

// Noun production card: 中文释义 → pick der/die/das + type the noun's plural.
// Auto-graded (all correct → good, any miss → again); an article miss folds a
// MORPHOLOGY:gender error tag. Fully offline, instant verdict (承重墙 #5).

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { speak } from "@/lib/tts";
import { targetBcp47 } from "@/lib/lang";
import type { Grade } from "@/lib/sr";
import type { JudgeErrorTag } from "@/lib/api/contracts";
import type { WordCardPayload } from "@/lib/types";

const ARTICLES = ["der", "die", "das"] as const;

export function NounProductionCard({
  payload,
  language,
  onGrade,
}: {
  payload: WordCardPayload;
  language: string;
  onGrade: (grade: Grade, errorTags?: JudgeErrorTag[]) => void;
}) {
  const t = useTranslations("a1");
  const [pickedArticle, setPickedArticle] = useState<string | null>(null);
  const [typedPlural, setTypedPlural] = useState("");
  const [noPluralPicked, setNoPluralPicked] = useState(false);
  const [checked, setChecked] = useState(false);

  const hasPlural = payload.plural != null;
  const articleRight = pickedArticle === payload.article;
  const pluralRight = useMemo(() => {
    if (!hasPlural) return noPluralPicked;
    return (
      !noPluralPicked &&
      typedPlural.trim().replace(/\s+/g, " ") === payload.plural
    );
  }, [hasPlural, noPluralPicked, typedPlural, payload.plural]);

  const canCheck =
    pickedArticle !== null && (noPluralPicked || typedPlural.trim().length > 0);

  const check = () => {
    if (!canCheck || checked) return;
    setChecked(true);
    void speak(`${payload.article} ${payload.lemma}`, {
      lang: targetBcp47(language),
    });
  };

  const finish = () => {
    const allRight = articleRight && pluralRight;
    const tags: JudgeErrorTag[] = [];
    if (!articleRight) tags.push({ type: "MORPHOLOGY", detail: "gender" });
    if (!pluralRight) tags.push({ type: "MORPHOLOGY", detail: "plural" });
    onGrade(allRight ? "good" : "again", tags.length > 0 ? tags : undefined);
  };

  return (
    <>
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-5 bg-white dark:bg-zinc-950 min-h-[280px]">
        <div>
          <p className="text-xs text-zinc-500 mb-1">{t("meaningLabel")}</p>
          <p className="text-xl">{payload.meaningZh}</p>
          <p className="text-2xl font-medium mt-2">{payload.lemma}</p>
        </div>

        <div>
          <p className="text-xs text-zinc-500 mb-2">{t("articleQuestion")}</p>
          <div className="grid grid-cols-3 gap-2">
            {ARTICLES.map((a) => {
              const picked = pickedArticle === a;
              const showState = checked
                ? a === payload.article
                  ? "border-green-500 bg-green-50 dark:bg-green-950"
                  : picked
                    ? "border-red-500 bg-red-50 dark:bg-red-950"
                    : "border-zinc-200 dark:border-zinc-800 opacity-50"
                : picked
                  ? "border-zinc-900 dark:border-zinc-100 font-semibold"
                  : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900";
              return (
                <button
                  key={a}
                  type="button"
                  disabled={checked}
                  onClick={() => setPickedArticle(a)}
                  className={`py-3 rounded-lg border text-lg ${showState}`}
                >
                  {a}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-xs text-zinc-500 mb-2">{t("pluralQuestion")}</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={typedPlural}
              onChange={(e) => {
                setTypedPlural(e.target.value);
                setNoPluralPicked(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") check();
              }}
              disabled={checked || noPluralPicked}
              placeholder={t("pluralPlaceholder")}
              className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-base disabled:opacity-50"
            />
            <button
              type="button"
              disabled={checked}
              onClick={() => {
                setNoPluralPicked((v) => !v);
                setTypedPlural("");
              }}
              className={`px-3 py-2 rounded-lg border text-sm ${
                noPluralPicked
                  ? "border-zinc-900 dark:border-zinc-100 font-semibold"
                  : "border-zinc-300 dark:border-zinc-700 text-zinc-500"
              }`}
            >
              {t("noPlural")}
            </button>
          </div>
          {checked && (
            <p
              className={`text-sm mt-2 ${
                pluralRight
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {hasPlural ? `die ${payload.plural}` : t("noPlural")}
            </p>
          )}
        </div>

        {checked && (
          <div className="border-t border-zinc-100 dark:border-zinc-800 pt-3">
            <p className="text-base">
              <span className="font-medium">
                {payload.article} {payload.lemma}
              </span>
              <span className="text-zinc-500"> — {payload.example}</span>
            </p>
          </div>
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
          disabled={!canCheck}
          className="py-4 rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium disabled:opacity-40"
        >
          {t("check")}
        </button>
      )}
    </>
  );
}
