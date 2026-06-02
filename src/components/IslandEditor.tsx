"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getIsland, listIslands, listSentencesByIsland } from "@/lib/db";
import { ensureSeedLoaded } from "@/lib/seedLoader";
import {
  addSentenceToIsland,
  createScenarioIsland,
  deleteSentence,
  moveSentence,
  reorderSentences,
  updateSentence,
} from "@/lib/cards";
import { prewarmAudio } from "@/lib/tts";
import { mergeKeywords } from "@/lib/vocab";
import { apiFetchJson } from "@/lib/api/client";
import type {
  ComposeResult,
  KeywordItem,
  KeywordsResult,
  SplitGroup,
  SplitResult,
  TargetLanguage,
} from "@/lib/api/contracts";
import type { Island, Sentence } from "@/lib/types";

const EMPTY_FIELDS = {
  native: "",
  target: "",
  ipa: null,
  frame: "",
  literal: "",
  note: "",
  variants: [],
};

// Edits one island's sentences (seed or user). Reads ?id= client-side, loads
// from IndexedDB, writes back via updateSentence/deleteSentence. The sentence id
// never changes, so spaced-repetition records stay attached.
export function IslandEditor({ uiLocale }: { uiLocale: string }) {
  const t = useTranslations("editor");

  const [islandId] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("id") ?? "";
  });
  const [state, setState] = useState<
    | { kind: "loading" }
    | {
        kind: "ready";
        island: Island;
        sentences: Sentence[];
        otherIslands: Island[];
      }
    | { kind: "notfound" }
  >({ kind: "loading" });

  const [splitState, setSplitState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; groups: SplitGroup[] }
    | { kind: "applying" }
    | { kind: "error"; detail: string }
  >({ kind: "idle" });

  const [kwState, setKwState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; items: KeywordItem[]; keep: boolean[] }
    | { kind: "applying" }
    | { kind: "done"; n: number }
    | { kind: "error"; detail: string }
  >({ kind: "idle" });

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!islandId) {
        if (alive) setState({ kind: "notfound" });
        return;
      }
      const language = islandId.split(".")[0] ?? "de";
      try {
        await ensureSeedLoaded(language);
      } catch {
        /* user islands don't depend on seed */
      }
      const island = await getIsland(islandId);
      if (!island) {
        if (alive) setState({ kind: "notfound" });
        return;
      }
      const sentences = await listSentencesByIsland(islandId);
      const otherIslands = (await listIslands(island.language)).filter(
        (i) => i.id !== islandId,
      );
      if (alive) setState({ kind: "ready", island, sentences, otherIslands });
    })();
    return () => {
      alive = false;
    };
  }, [islandId]);

  const onDeleted = useCallback((id: string) => {
    setState((s) =>
      s.kind === "ready"
        ? { ...s, sentences: s.sentences.filter((x) => x.id !== id) }
        : s,
    );
  }, []);

  // Swap a sentence with its neighbour and persist the new order. Rows are keyed
  // by id, so React keeps each row's unsaved edits as they move.
  const move = useCallback((id: string, dir: -1 | 1) => {
    setState((s) => {
      if (s.kind !== "ready") return s;
      const arr = [...s.sentences];
      const i = arr.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return s;
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      void reorderSentences(arr.map((x) => x.id));
      return { ...s, sentences: arr };
    });
  }, []);

  const addSentence = useCallback(async (island: Island) => {
    const sentence = await addSentenceToIsland(island, EMPTY_FIELDS);
    setState((s) =>
      s.kind === "ready" ? { ...s, sentences: [...s.sentences, sentence] } : s,
    );
  }, []);

  if (state.kind === "loading") {
    return (
      <main className="flex flex-1 items-center justify-center p-12">
        <p className="text-sm text-zinc-500">{t("loading")}</p>
      </main>
    );
  }
  if (state.kind === "notfound") {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-12">
        <p className="text-sm text-zinc-500">{t("notfound")}</p>
        <a
          href={`/${uiLocale}/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          {t("back")}
        </a>
      </main>
    );
  }

  const { island, sentences, otherIslands } = state;

  async function requestSplit() {
    setSplitState({ kind: "loading" });
    try {
      const r = await apiFetchJson<SplitResult>("/v1/split", {
        language: island.language as TargetLanguage,
        islandName: island.name,
        sentences: sentences.map((s) => ({ native: s.native, target: s.target })),
      });
      setSplitState({ kind: "ready", groups: r.groups });
    } catch (e) {
      setSplitState({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  // Keep the first group in this island; move the rest into new sub-islands.
  // ids are mapped up front (stable across moves), so order of moving is safe.
  async function applySplit(groups: SplitGroup[]) {
    setSplitState({ kind: "applying" });
    try {
      for (let g = 1; g < groups.length; g++) {
        const ids = groups[g]!.indices
          .map((idx) => sentences[idx]?.id)
          .filter((x): x is string => Boolean(x));
        if (ids.length === 0) continue;
        const sub = await createScenarioIsland(
          island.language as TargetLanguage,
          groups[g]!.subIslandName,
        );
        for (const id of ids) await moveSentence(id, sub.id);
      }
      const fresh = await listSentencesByIsland(island.id);
      const others = (await listIslands(island.language)).filter(
        (i) => i.id !== island.id,
      );
      setState({ kind: "ready", island, sentences: fresh, otherIslands: others });
      setSplitState({ kind: "idle" });
    } catch (e) {
      setSplitState({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  async function requestKeywords() {
    setKwState({ kind: "loading" });
    try {
      const r = await apiFetchJson<KeywordsResult>("/v1/keywords", {
        language: island.language as TargetLanguage,
        islandName: island.name,
        sentences: sentences.map((s) => ({ native: s.native, target: s.target })),
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
        island.language,
        island.id,
        sentences.map((s) => ({ id: s.id, target: s.target })),
        chosen,
      );
      setKwState({ kind: "done", n });
      window.setTimeout(() => setKwState({ kind: "idle" }), 2500);
    } catch (e) {
      setKwState({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-6 max-w-2xl mx-auto w-full">
      <header className="flex items-baseline justify-between gap-3">
        <a
          href={`/${uiLocale}/${island.language}/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          ← {t("back")}
        </a>
        <h1 className="text-lg font-medium truncate">{island.name}</h1>
        <span className="text-sm text-zinc-500 tabular-nums shrink-0">
          {t("count", { n: sentences.length })}
        </span>
      </header>

      <p className="text-xs text-zinc-500">{t("hint")}</p>

      {splitState.kind === "loading" && (
        <p className="text-sm text-zinc-500">{t("splitLoading")}</p>
      )}
      {splitState.kind === "applying" && (
        <p className="text-sm text-zinc-500">{t("splitApplying")}</p>
      )}
      {splitState.kind === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {t("splitFailed", { detail: splitState.detail })}
        </p>
      )}
      {splitState.kind === "ready" && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
          <p className="text-sm font-medium">{t("splitTitle")}</p>
          <ul className="space-y-1 text-sm">
            {splitState.groups.map((g, i) => (
              <li key={i}>
                <span className="font-medium">{g.subIslandName}</span>
                <span className="text-zinc-500">
                  {" · "}
                  {t("count", { n: g.indices.length })}
                </span>
                {i === 0 && (
                  <span className="text-xs text-zinc-400"> {t("splitStays")}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => applySplit(splitState.groups)}
              className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium"
            >
              {t("splitApply")}
            </button>
            <button
              type="button"
              onClick={() => setSplitState({ kind: "idle" })}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm"
            >
              {t("splitCancel")}
            </button>
          </div>
        </div>
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

      {sentences.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <ul className="space-y-4">
          {sentences.map((s, i) => (
            <li key={s.id}>
              <SentenceRow
                index={i}
                sentence={s}
                onDeleted={onDeleted}
                onMove={move}
                onMovedOut={onDeleted}
                otherIslands={otherIslands}
                isFirst={i === 0}
                isLast={i === sentences.length - 1}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => addSentence(island)}
          className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-400"
        >
          {t("addSentence")}
        </button>
        {sentences.length > 12 && splitState.kind === "idle" && (
          <button
            type="button"
            onClick={requestSplit}
            title={t("splitHint")}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-600 dark:text-zinc-300"
          >
            {t("splitSuggest")}
          </button>
        )}
        {sentences.length > 0 && kwState.kind === "idle" && (
          <button
            type="button"
            onClick={requestKeywords}
            title={t("kwHint")}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-600 dark:text-zinc-300"
          >
            {t("extractKeywords")}
          </button>
        )}
      </div>
    </main>
  );
}

const inputCls =
  "w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function SentenceRow({
  index,
  sentence,
  onDeleted,
  onMove,
  onMovedOut,
  otherIslands,
  isFirst,
  isLast,
}: {
  index: number;
  sentence: Sentence;
  onDeleted: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onMovedOut: (id: string) => void;
  otherIslands: Island[];
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useTranslations("editor");
  const [target, setTarget] = useState(sentence.target);
  const [native, setNative] = useState(sentence.native);
  const [frame, setFrame] = useState(sentence.frame);
  const [literal, setLiteral] = useState(sentence.literal);
  const [note, setNote] = useState(sentence.note);
  const [ipa, setIpa] = useState(sentence.ipa ?? "");
  const [variants, setVariants] = useState<string[]>(sentence.variants);
  const [savedFlash, setSavedFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenFlash, setRegenFlash] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    const cleanedVariants = variants.map((v) => v.trim()).filter(Boolean);
    const cleanIpa = ipa.trim();
    await updateSentence(sentence.id, {
      target: target.trim(),
      native: native.trim(),
      frame: frame.trim(),
      literal: literal.trim(),
      note: note.trim(),
      ipa: cleanIpa || null,
      variants: cleanedVariants,
    });
    setVariants(cleanedVariants);
    // Regenerate audio for the (possibly new) target text, best-effort.
    void prewarmAudio(target.trim(), sentence.language, 1);
    void prewarmAudio(target.trim(), sentence.language, 0.7);
    setBusy(false);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1500);
  }

  async function remove() {
    if (!window.confirm(t("confirmDeleteSentence"))) return;
    setBusy(true);
    await deleteSentence(sentence.id);
    onDeleted(sentence.id);
  }

  async function moveTo(targetIslandId: string) {
    if (!targetIslandId) return;
    setBusy(true);
    await moveSentence(sentence.id, targetIslandId);
    onMovedOut(sentence.id);
  }

  // Regenerate the card from its meaning via the authoring task (strong model).
  // Fills the fields in place; native is kept as the anchor. User reviews + saves.
  async function regenerate() {
    if (!native.trim()) return;
    setBusy(true);
    setRegenBusy(true);
    setAiError(null);
    try {
      const r = await apiFetchJson<ComposeResult>("/v1/compose", {
        language: sentence.language as TargetLanguage,
        native: native.trim(),
      });
      setTarget(r.target);
      setFrame(r.frame);
      setLiteral(r.literal);
      setNote(r.note);
      setIpa(r.ipa ?? "");
      setVariants(r.variants);
      setRegenFlash(true);
      window.setTimeout(() => setRegenFlash(false), 2500);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setRegenBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3 bg-white dark:bg-zinc-950">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 tabular-nums">#{index + 1}</span>
          <button
            type="button"
            onClick={() => onMove(sentence.id, -1)}
            disabled={busy || isFirst}
            aria-label={t("moveUp")}
            title={t("moveUp")}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => onMove(sentence.id, 1)}
            disabled={busy || isLast}
            aria-label={t("moveDown")}
            title={t("moveDown")}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-30"
          >
            ▼
          </button>
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-xs text-zinc-400 hover:text-red-500 disabled:opacity-40"
        >
          {t("deleteSentence")}
        </button>
      </div>

      <Field label={t("fTarget")}>
        <input className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} />
      </Field>
      <Field label={t("fNative")}>
        <input className={inputCls} value={native} onChange={(e) => setNative(e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("fFrame")}>
          <input className={inputCls} value={frame} onChange={(e) => setFrame(e.target.value)} />
        </Field>
        <Field label={t("fLiteral")}>
          <input className={inputCls} value={literal} onChange={(e) => setLiteral(e.target.value)} />
        </Field>
      </div>

      <Field label={t("fNote")}>
        <textarea
          className={`${inputCls} min-h-[3rem] resize-y`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <Field label={t("fIpa")}>
        <input
          className={`${inputCls} font-mono`}
          value={ipa}
          onChange={(e) => setIpa(e.target.value)}
        />
      </Field>

      <div className="space-y-1">
        <span className="text-xs text-zinc-500">{t("fVariants")}</span>
        <ul className="space-y-2">
          {variants.map((v, i) => (
            <li key={i} className="flex gap-2">
              <input
                className={inputCls}
                value={v}
                onChange={(e) =>
                  setVariants((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              <button
                type="button"
                onClick={() => setVariants((arr) => arr.filter((_, j) => j !== i))}
                aria-label={t("removeVariant")}
                title={t("removeVariant")}
                className="shrink-0 rounded-md border border-zinc-200 dark:border-zinc-800 px-2 text-zinc-300 hover:text-red-500 hover:border-red-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setVariants((arr) => [...arr, ""])}
          className="text-xs text-zinc-500 hover:underline underline-offset-4"
        >
          {t("addVariant")}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {savedFlash ? t("saved") : t("save")}
          </button>
          <button
            type="button"
            onClick={regenerate}
            disabled={busy || !native.trim()}
            title={t("regenerateHint")}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 disabled:opacity-40"
          >
            {regenBusy ? t("regenerating") : t("regenerate")}
          </button>
        </div>
        {otherIslands.length > 0 && (
          <select
            value=""
            onChange={(e) => moveTo(e.target.value)}
            disabled={busy}
            aria-label={t("moveTo")}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-500 max-w-[10rem] disabled:opacity-50"
          >
            <option value="">{t("moveTo")}</option>
            {otherIslands.map((isl) => (
              <option key={isl.id} value={isl.id}>
                {isl.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {regenFlash && (
        <p className="text-xs text-green-600 dark:text-green-400">
          {t("regenerated")}
        </p>
      )}
      {aiError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {t("regenerateFailed", { detail: aiError })}
        </p>
      )}
    </div>
  );
}
