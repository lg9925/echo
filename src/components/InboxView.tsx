"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { TargetLanguage } from "@/lib/api/contracts";
import { InboxCapture } from "./InboxCapture";
import { InboxList } from "./InboxList";

// Client container: owns the refresh signal that ties capture → list together
// (a server component can't pass callbacks between two client children).
// Scoped to one target language (the language hub it lives under).
export function InboxView({
  uiLocale,
  language,
}: {
  uiLocale: string;
  language: TargetLanguage;
}) {
  const t = useTranslations("inbox");
  const tLang = useTranslations("languages");
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-12 max-w-2xl mx-auto w-full">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("title")}
          <span className="ml-2 text-sm font-normal text-zinc-500">
            {tLang(language)}
          </span>
        </h1>
        <a
          href={`/${uiLocale}/${language}/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          {t("back")}
        </a>
      </header>

      <InboxCapture language={language} onCaptured={bump} />
      <InboxList uiLocale={uiLocale} language={language} refreshKey={refreshKey} />
    </main>
  );
}
