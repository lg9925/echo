"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getProfile, saveProfile } from "@/lib/profile";
import type { CefrLevel, TargetLanguage } from "@/lib/api/contracts";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function ProfileView({
  uiLocale,
  language,
}: {
  uiLocale: string;
  language: TargetLanguage;
}) {
  const t = useTranslations("profile");
  const [level, setLevel] = useState<CefrLevel | "">("");
  const [background, setBackground] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    const p = getProfile(language);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage rehydration after mount
    setLevel(p.level ?? "");
    setBackground(p.background);
  }, [language]);

  function save() {
    saveProfile(language, { level: level || null, background });
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1500);
  }

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-10 max-w-2xl mx-auto w-full">
      <header className="flex items-baseline justify-between gap-3">
        <a
          href={`/${uiLocale}/${language}/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          ← {t("back")}
        </a>
        <h1 className="text-lg font-medium">{t("title")}</h1>
        <span className="w-8" />
      </header>

      <p className="text-sm text-zinc-500">{t("hint")}</p>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("level")}</span>
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as CefrLevel | "")}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        >
          <option value="">{t("levelNone")}</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("background")}</span>
        <textarea
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          placeholder={t("backgroundPlaceholder")}
          rows={4}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm resize-y"
        />
        <span className="text-xs text-zinc-500">{t("backgroundHint")}</span>
      </label>

      <div>
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium"
        >
          {savedFlash ? t("saved") : t("save")}
        </button>
      </div>
    </main>
  );
}
