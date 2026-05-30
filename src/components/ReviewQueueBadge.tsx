"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { countDueForLanguage } from "@/lib/db";
import { ensureSeedLoaded } from "@/lib/seedLoader";

export function ReviewQueueBadge({
  language,
  uiLocale,
}: {
  language: string;
  uiLocale: string;
}) {
  const t = useTranslations("review");
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

  if (count === null) return null;

  return (
    <a
      href={`/${uiLocale}/review/?lang=${language}`}
      className="inline-flex items-baseline gap-2 px-3 py-1.5 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-sm hover:opacity-90"
    >
      <span>{t("title")}</span>
      <span className="tabular-nums opacity-80">
        {count > 0 ? t("dueBadge", { n: count }) : t("noDue")}
      </span>
    </a>
  );
}
