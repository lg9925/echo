"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { listInbox } from "@/lib/inbox";
import type { InboxItem } from "@/lib/types";
import type { TargetLanguage } from "@/lib/api/contracts";
import { InboxItemCard } from "./InboxItemCard";

export function InboxList({
  uiLocale,
  language,
  refreshKey,
}: {
  uiLocale: string;
  language: TargetLanguage;
  refreshKey: number;
}) {
  const t = useTranslations("inbox");
  const [items, setItems] = useState<InboxItem[] | null>(null);

  const reload = useCallback(() => {
    listInbox(language).then(setItems);
  }, [language]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  if (items === null) return null; // pre-hydration / loading

  if (items.length === 0) {
    return <p className="text-sm text-zinc-500 px-1">{t("empty")}</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <InboxItemCard
          key={item.id}
          item={item}
          uiLocale={uiLocale}
          onChanged={reload}
        />
      ))}
    </ul>
  );
}
