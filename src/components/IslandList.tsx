"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  countSentencesByIsland,
  dueCountsByIsland,
  listIslands,
} from "@/lib/db";
import { ensureSeedLoaded } from "@/lib/seedLoader";
import { getApiToken } from "@/lib/settings";
import { deleteIsland, islandHref, isUserIslandId } from "@/lib/cards";
import {
  deleteIslandAudio,
  downloadIsland,
  islandAudioStatus,
  type IslandAudioStatus,
} from "@/lib/offlineAudio";
import type { Island } from "@/lib/types";

interface IslandWithCount extends Island {
  sentenceCount: number;
  dueCount: number;
  audio: IslandAudioStatus;
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
      const due = await dueCountsByIsland(language, Date.now());
      const withCounts = await Promise.all(
        islands.map(async (isl) => ({
          ...isl,
          sentenceCount: await countSentencesByIsland(isl.id),
          dueCount: due[isl.id] ?? 0,
          audio: await islandAudioStatus(isl.id, language),
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

  // islandId → live progress while its offline download runs.
  const [dl, setDl] = useState<Record<string, { done: number; total: number }>>(
    {},
  );

  async function downloadAudio(isl: IslandWithCount) {
    if (!getApiToken()) {
      window.alert(t("offlineNeedToken"));
      return;
    }
    setDl((d) => ({ ...d, [isl.id]: { done: 0, total: isl.sentenceCount } }));
    const res = await downloadIsland(isl.id, language, (done, total) =>
      setDl((d) => ({ ...d, [isl.id]: { done, total } })),
    );
    setDl((d) => {
      const next = { ...d };
      delete next[isl.id];
      return next;
    });
    if (res.failed > 0) window.alert(t("offlineFailed", { n: res.failed }));
    await load();
  }

  async function removeAudio(isl: IslandWithCount) {
    if (!window.confirm(t("confirmDeleteOfflineAudio", { name: isl.name }))) return;
    await deleteIslandAudio(isl.id, language);
    await load();
  }

  function offlineButton(isl: IslandWithCount) {
    const base =
      "shrink-0 flex items-center rounded-lg border px-3 text-sm transition-colors";
    const prog = dl[isl.id];
    if (prog) {
      return (
        <span
          className={`${base} border-zinc-200 dark:border-zinc-800 text-zinc-500 tabular-nums`}
        >
          {t("offlineDownloading", { done: prog.done, total: prog.total })}
        </span>
      );
    }
    const full = isl.audio.total > 0 && isl.audio.cached === isl.audio.total;
    if (full) {
      return (
        <button
          type="button"
          onClick={() => removeAudio(isl)}
          aria-label={t("offlineReady")}
          title={t("offlineReady")}
          className={`${base} border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:border-red-300 hover:text-red-500`}
        >
          ⬇✓
        </button>
      );
    }
    const partial = isl.audio.cached > 0;
    return (
      <button
        type="button"
        onClick={() => downloadAudio(isl)}
        aria-label={t("offlineDownload")}
        title={
          partial
            ? t("offlinePartial", { cached: isl.audio.cached, total: isl.audio.total })
            : t("offlineDownload")
        }
        className={`${base} border-zinc-200 dark:border-zinc-800 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300`}
      >
        ⬇{partial && <span className="ml-1 text-xs tabular-nums">{isl.audio.cached}/{isl.audio.total}</span>}
      </button>
    );
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
          {isl.dueCount > 0 && (
            <a
              href={`/${uiLocale}/review/?lang=${language}&island=${encodeURIComponent(isl.id)}`}
              title={t("islandReviewTitle")}
              className="shrink-0 flex items-center rounded-lg border border-amber-300 dark:border-amber-700 px-3 text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950"
            >
              {t("islandDue", { n: isl.dueCount })}
            </a>
          )}
          {offlineButton(isl)}
          <a
            href={`/${uiLocale}/${language}/vocab/?island=${encodeURIComponent(isl.id)}`}
            aria-label={t("extractTitle")}
            title={t("extractTitle")}
            className="shrink-0 flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300"
          >
            🔑
          </a>
          <a
            href={`/${uiLocale}/edit/?id=${encodeURIComponent(isl.id)}`}
            aria-label={t("editIsland")}
            title={t("editIsland")}
            className="shrink-0 flex items-center rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-300"
          >
            ✎
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
