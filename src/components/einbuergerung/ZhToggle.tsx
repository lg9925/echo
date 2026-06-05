"use client";

import { useTranslations } from "next-intl";

/** Header pill toggling the global "show Chinese by default" preference. */
export function ZhToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("einbuergerung");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`rounded-full px-3 py-1 text-xs border transition-colors ${
        on
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
          : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
      }`}
    >
      {on ? t("zhOn") : t("zhOff")}
    </button>
  );
}
