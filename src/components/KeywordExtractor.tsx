"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { listSentencesByIsland } from "@/lib/db";
import { mergeKeywords } from "@/lib/vocab";
import { profileForRequest } from "@/lib/profile";
import { apiFetchJson } from "@/lib/api/client";
import type {
  KeywordItem,
  KeywordsResult,
  TargetLanguage,
} from "@/lib/api/contracts";
import type { Sentence } from "@/lib/types";

// Self-contained "extract this island's key words → 字词表" control. Used from
// the editor, the island player, and the vocab page. Loads the island's
// sentences itself, so callers only pass identity.
export function KeywordExtractor({
  language,
  islandId,
  islandName,
  onMerged,
}: {
  language: string;
  islandId: string;
  islandName: string;
  /** Called after words are merged into the 字词表 (e.g. to refresh a list). */
  onMerged?: () => void;
}) {
  const t = useTranslations("editor");
  const sentencesRef = useRef<Sentence[]>([]);
  const [kwState, setKwState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; items: KeywordItem[]; keep: boolean[] }
    | { kind: "applying" }
    | { kind: "done"; n: number }
    | { kind: "error"; detail: string }
  >({ kind: "idle" });

  async function requestKeywords() {
    setKwState({ kind: "loading" });
    try {
      const sentences = await listSentencesByIsland(islandId);
      sentencesRef.current = sentences;
      if (sentences.length === 0) {
        setKwState({ kind: "error", detail: t("kwEmpty") });
        return;
      }
      const r = await apiFetchJson<KeywordsResult>("/v1/keywords", {
        language: language as TargetLanguage,
        islandName,
        sentences: sentences.map((s) => ({ native: s.native, target: s.target })),
        profile: profileForRequest(language),
      });
      setKwState({ kind: "ready", items: r.keywords, keep: r.keywords.map(() => true) });
    } catch (e) {
      setKwState({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  async function applyKeywords(items: KeywordItem[], keep: boolean[]) {
    setKwState({ kind: "applying" });
    try {
      const chosen = items.filter((_, i) => keep[i]);
      const n = await mergeKeywords(
        language,
        islandId,
        sentencesRef.current.map((s) => ({ id: s.id, target: s.target })),
        chosen,
      );
      setKwState({ kind: "done", n });
      onMerged?.();
      window.setTimeout(() => setKwState({ kind: "idle" }), 2500);
    } catch (e) {
      setKwState({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="space-y-3">
      {kwState.kind === "idle" && (
        <button
          type="button"
          onClick={requestKeywords}
          title={t("kwHint")}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-600 dark:text-zinc-300"
        >
          {t("extractKeywords")}
        </button>
      )}
      {kwState.kind === "loading" && (
        <p className="text-sm text-zinc-500">{t("kwLoading")}</p>
      )}
      {kwState.kind === "applying" && (
        <p className="text-sm text-zinc-500">{t("kwApplying")}</p>
      )}
      {kwState.kind === "done" && (
        <p className="text-sm text-green-600 dark:text-green-400">
          {t("kwDone", { n: kwState.n })}
        </p>
      )}
      {kwState.kind === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {t("kwFailed", { detail: kwState.detail })}
        </p>
      )}
      {kwState.kind === "ready" && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
          <p className="text-sm font-medium">{t("kwTitle")}</p>
          <ul className="space-y-1.5 text-sm max-h-80 overflow-auto">
            {kwState.items.map((kw, i) => (
              <li key={i} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={kwState.keep[i]}
                  onChange={(e) =>
                    setKwState((s) =>
                      s.kind === "ready"
                        ? { ...s, keep: s.keep.map((v, j) => (j === i ? e.target.checked : v)) }
                        : s,
                    )
                  }
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{kw.term}</span>
                  {kw.meaning && <span className="text-zinc-500"> — {kw.meaning}</span>}
                  <span className="text-xs text-zinc-400">
                    {" "}
                    ({t("kwOccur", { n: kw.indices.length })})
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => applyKeywords(kwState.items, kwState.keep)}
              className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium"
            >
              {t("kwApply")}
            </button>
            <button
              type="button"
              onClick={() => setKwState({ kind: "idle" })}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm"
            >
              {t("splitCancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
