"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { countSentencesByIsland, listIslands } from "@/lib/db";
import { ensureSeedLoaded } from "@/lib/seedLoader";
import { deleteIsland, islandHref, isUserIslandId } from "@/lib/cards";
import type { Island } from "@/lib/types";

interface IslandWithCount extends Island {
  sentenceCount: number;
}

export function IslandList({
  language,
  uiLocale,
}: {
  language: string;
  uiLocale: string;
}) {
  const t = useTranslations("home");
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; islands: IslandWithCount[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      await ensureSeedLoaded(language);
      const islands = await listIslands(language);
      const withCounts = await Promise.all(
        islands.map(async (isl) => ({
          ...isl,
          sentenceCount: await countSentencesByIsland(isl.id),
        })),
      );
      setState({ kind: "ready", islands: withCounts });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [language]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load; setState runs post-await
    load();
  }, [load]);

  async function remove(isl: IslandWithCount) {
    if (!window.confirm(t("confirmDeleteIsland", { name: isl.name }))) return;
    await deleteIsland(isl.id);
    await load();
  }

  if (state.kind === "loading") {
    return <p className="text-sm text-zinc-500">…</p>;
  }
  if (state.kind === "error") {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
    );
  }
  if (state.islands.length === 0) {
    return <p className="text-sm text-zinc-500">{t("noData")}</p>;
  }

  return (
    <ul className="space-y-2">
      {state.islands.map((isl) => (
        <li key={isl.id} className="flex items-stretch gap-2">
          <a
            href={islandHref(uiLocale, isl.id)}
            className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{isl.name}</span>
              <span className="text-xs text-zinc-500">{isl.sentenceCount}</span>
            </div>
          </a>
          {isUserIslandId(isl.id) && (
            <button
              type="button"
              onClick={() => remove(isl)}
              aria-label={t("deleteIsland")}
              title={t("deleteIsland")}
              className="shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 text-zinc-300 hover:text-red-500 hover:border-red-300"
            >
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
