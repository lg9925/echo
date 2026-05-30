"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { countDueForLanguage } from "@/lib/db";
import { ensureSeedLoaded } from "@/lib/seedLoader";

// Home-screen module card for one target language. The whole card links to the
// language hub; the due count is shown inline (not a nested link).
export function LanguageCard({
  language,
  uiLocale,
}: {
  language: string;
  uiLocale: string;
}) {
  const tLang = useTranslations("languages");
  const tReview = useTranslations("review");
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureSeedLoaded(language);
        const n = await countDueForLanguage(language, Date.now());
        if (!cancelled) setCount(n);
      } catch {
        if (!cancelled) setCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language]);

  return (
    <a
      href={`/${uiLocale}/${language}/`}
      className="block rounded-2xl border border-zinc-200 dark:border-zinc-800 px-6 py-5 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xl font-semibold tracking-tight">
          {tLang(language)}
        </span>
        <span className="text-sm text-zinc-500 tabular-nums">
          {count === null
            ? ""
            : count > 0
              ? tReview("dueBadge", { n: count })
              : tReview("noDue")}
        </span>
      </div>
    </a>
  );
}
