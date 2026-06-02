"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Island, InboxItem, InboxStatus } from "@/lib/types";
import type {
  ComposeResult,
  GlossResult,
  ScenarioResult,
  ScenarioSentence,
  TargetLanguage,
} from "@/lib/api/contracts";
import { upsertVocab } from "@/lib/vocab";
import { deleteInboxItem, processInboxItem, updateInboxItem } from "@/lib/inbox";
import { listIslands } from "@/lib/db";
import { ensureSeedLoaded } from "@/lib/seedLoader";
import {
  addSentenceToIsland,
  addSentencesToIsland,
  composeToFields,
  createScenarioIsland,
  getOrCreatePickedIsland,
  glossToFields,
  islandHref,
  pickedIslandId,
  scenarioToFieldsList,
} from "@/lib/cards";
import { prewarmAudio } from "@/lib/tts";

const STATUS_STYLES: Record<InboxStatus, string> = {
  captured: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200",
  ready: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200",
  error: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200",
  added: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200",
};

// Guards against firing the same auto-process twice across list re-renders.
const inFlight = new Set<string>();

export function InboxItemCard({
  item,
  uiLocale,
  onChanged,
}: {
  item: InboxItem;
  uiLocale: string;
  onChanged: () => void;
}) {
  const t = useTranslations("inbox");
  const tLang = useTranslations("languages");

  const [islands, setIslands] = useState<Island[]>([]);
  const [islandChoice, setIslandChoice] = useState<string>("");
  const [candidateIdx, setCandidateIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const pickedId = pickedIslandId(item.language);

  // Auto-complete in the background. Also picks up items stuck in "processing"
  // (e.g. the page was reloaded mid-call) since inFlight resets per page load.
  useEffect(() => {
    const needsRun = item.status === "captured" || item.status === "processing";
    if (!needsRun || inFlight.has(item.id)) return;
    inFlight.add(item.id);
    // onStatus → UI flips to "处理中…" the moment the call starts; onProgress →
    // live scenario sentence count (streamed), instead of a blank wait.
    processInboxItem(item.id, {
      onStatus: onChanged,
      onProgress: (p) => setProgress(p.sentences),
    }).finally(() => {
      inFlight.delete(item.id);
      setProgress(null);
      onChanged();
    });
  }, [item.id, item.status, onChanged]);

  // When ready, load island options and pick a sensible default.
  // Scenario items create their own named island, so skip the picker.
  useEffect(() => {
    if (item.status !== "ready" || item.kind === "scenario") return;
    let alive = true;
    // Ensure seed islands exist even if the user opened the inbox first.
    ensureSeedLoaded(item.language)
      .catch(() => {})
      .then(() => listIslands(item.language))
      .then((all) => {
        if (!alive) return;
        const seedIslands = all.filter((i) => i.id !== pickedId);
        setIslands(seedIslands);
        const result = item.result as ComposeResult | GlossResult | undefined;
        const suggested = result?.suggestedIslandName?.trim().toLowerCase();
        const match = suggested
          ? seedIslands.find((i) => i.name.trim().toLowerCase() === suggested)
          : undefined;
        setIslandChoice(match ? match.id : pickedId);
      });
    return () => {
      alive = false;
    };
  }, [item.status, item.kind, item.language, item.result, pickedId]);

  const statusLabel = {
    captured: t("statusCaptured"),
    processing: t("statusProcessing"),
    ready: t("statusReady"),
    error: t("statusError"),
    added: t("statusAdded"),
  }[item.status];

  async function remove() {
    await deleteInboxItem(item.id);
    onChanged();
  }

  // Manual re-run (retry after error / regenerate a scenario). Optionally
  // swap in an edited description first. Guarded by inFlight so it can't
  // double-fire with the auto-process effect once status flips to processing.
  function reprocess(description?: string) {
    if (inFlight.has(item.id)) return;
    inFlight.add(item.id);
    setProgress(null);
    void (async () => {
      const next = description?.trim();
      if (next && next !== item.rawText) {
        await updateInboxItem(item.id, { rawText: next });
      }
      await processInboxItem(item.id, {
        onStatus: onChanged,
        onProgress: (p) => setProgress(p.sentences),
      });
    })().finally(() => {
      inFlight.delete(item.id);
      setProgress(null);
      onChanged();
    });
  }

  async function addToLearning() {
    if (!item.result || busy) return;
    setBusy(true);
    try {
      const island =
        islandChoice === pickedId
          ? await getOrCreatePickedIsland(item.language, t("pickedIsland"))
          : islands.find((i) => i.id === islandChoice);
      if (!island) return;

      const fields =
        item.kind === "say"
          ? composeToFields(item.result as ComposeResult)
          : glossToFields(
              item.result as GlossResult,
              (item.result as GlossResult).candidates[candidateIdx]!,
            );

      const sentence = await addSentenceToIsland(island, fields);
      await updateInboxItem(item.id, {
        status: "added",
        addedSentenceId: sentence.id,
        addedIslandId: island.id,
      });
      // Pre-warm neural audio so the first shadow play is instant (fire-and-forget).
      void prewarmAudio(fields.target, item.language, 1);
      void prewarmAudio(fields.target, item.language, 0.7);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function buildScenarioIsland(name: string, sentences: ScenarioSentence[]) {
    if (busy || sentences.length === 0) return;
    setBusy(true);
    try {
      const island = await createScenarioIsland(item.language, name);
      await addSentencesToIsland(island, scenarioToFieldsList(sentences));
      await updateInboxItem(item.id, { status: "added", addedIslandId: island.id });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">
            {item.kind === "say"
              ? t("kindSay")
              : item.kind === "understand"
                ? t("kindUnderstand")
                : t("kindScenario")}
          </span>
          <span className="text-zinc-500">{tLang(item.language)}</span>
          <span
            className={`rounded-full px-2 py-0.5 ${STATUS_STYLES[item.status]} ${
              item.status === "processing" ? "animate-pulse" : ""
            }`}
          >
            {statusLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={remove}
          className="text-xs text-zinc-400 hover:text-red-500"
        >
          {t("delete")}
        </button>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">{item.rawText}</p>

      {item.status === "processing" && <ProcessingIndicator sentences={progress} />}

      {item.status === "error" && (
        <div className="space-y-2">
          {item.error && <p className="text-xs text-red-500">{item.error}</p>}
          <button
            type="button"
            onClick={() => reprocess()}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {item.status === "ready" &&
        item.result &&
        (item.kind === "scenario" ? (
          <ScenarioPanel
            result={item.result as ScenarioResult}
            defaultDescription={item.rawText}
            busy={busy}
            onCreate={buildScenarioIsland}
            onRegenerate={reprocess}
          />
        ) : (
          <ResultPanel
            item={item}
            islands={islands}
            pickedId={pickedId}
            islandChoice={islandChoice}
            onIslandChoice={setIslandChoice}
            candidateIdx={candidateIdx}
            onCandidateIdx={setCandidateIdx}
            busy={busy}
            onAdd={addToLearning}
          />
        ))}

      {item.status === "added" && item.addedIslandId && (
        <a
          href={islandHref(uiLocale, item.addedIslandId)}
          className="inline-block text-sm font-medium text-green-700 dark:text-green-400 underline-offset-4 hover:underline"
        >
          {t("openIsland")}
        </a>
      )}
    </li>
  );
}

function ResultPanel({
  item,
  islands,
  pickedId,
  islandChoice,
  onIslandChoice,
  candidateIdx,
  onCandidateIdx,
  busy,
  onAdd,
}: {
  item: InboxItem;
  islands: Island[];
  pickedId: string;
  islandChoice: string;
  onIslandChoice: (id: string) => void;
  candidateIdx: number;
  onCandidateIdx: (i: number) => void;
  busy: boolean;
  onAdd: () => void;
}) {
  const t = useTranslations("inbox");

  return (
    <div className="space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-3">
      {item.kind === "say" ? (
        <ComposePreview result={item.result as ComposeResult} />
      ) : (
        <GlossPreview
          result={item.result as GlossResult}
          language={item.language}
          candidateIdx={candidateIdx}
          onCandidateIdx={onCandidateIdx}
        />
      )}

      <label className="block space-y-1">
        <span className="text-xs text-zinc-500">{t("chooseIsland")}</span>
        <select
          value={islandChoice}
          onChange={(e) => onIslandChoice(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
        >
          <option value={pickedId}>{t("pickedIsland")}</option>
          {islands.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={onAdd}
        disabled={busy}
        className="w-full rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {t("addToLearning")}
      </button>
    </div>
  );
}

function ScenarioPanel({
  result,
  defaultDescription,
  busy,
  onCreate,
  onRegenerate,
}: {
  result: ScenarioResult;
  defaultDescription: string;
  busy: boolean;
  onCreate: (name: string, sentences: ScenarioSentence[]) => void;
  onRegenerate: (description: string) => void;
}) {
  const t = useTranslations("inbox");
  const [name, setName] = useState(result.islandName);
  const [description, setDescription] = useState(defaultDescription);
  // Local, editable copy — drop or edit sentences before building.
  const [sentences, setSentences] = useState<ScenarioSentence[]>(result.sentences);

  function removeAt(idx: number) {
    setSentences((list) => list.filter((_, i) => i !== idx));
  }
  function editAt(idx: number, patch: Partial<ScenarioSentence>) {
    setSentences((list) => list.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  return (
    <div className="space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-3">
      {/* Edit the description and regenerate a fresh version. */}
      <label className="block space-y-1">
        <span className="text-xs text-zinc-500">{t("scenarioDescription")}</span>
        <div className="flex items-start gap-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => onRegenerate(description)}
            disabled={busy || !description.trim()}
            className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {t("regenerate")}
          </button>
        </div>
      </label>

      <label className="block space-y-1">
        <span className="text-xs text-zinc-500">{t("islandName")}</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
        />
      </label>

      <p className="text-xs text-zinc-500">
        {t("sentenceCount", { n: sentences.length })}
      </p>
      <ol className="space-y-2 max-h-80 overflow-auto pr-1">
        {sentences.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-2 w-5 shrink-0 text-right tabular-nums text-zinc-400">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <input
                value={s.target}
                onChange={(e) => editAt(i, { target: e.target.value })}
                className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-2 py-1 text-zinc-800 dark:text-zinc-200"
              />
              <input
                value={s.native}
                onChange={(e) => editAt(i, { native: e.target.value })}
                className="w-full rounded-md border border-transparent hover:border-zinc-200 dark:hover:border-zinc-800 bg-transparent px-2 py-0.5 text-xs text-zinc-500"
              />
            </div>
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={t("delete")}
              className="mt-1 shrink-0 text-zinc-300 hover:text-red-500"
            >
              ✕
            </button>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => onCreate(name, sentences)}
        disabled={busy || sentences.length === 0}
        className="w-full rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {t("createIsland")}
      </button>
    </div>
  );
}

function ProcessingIndicator({ sentences }: { sentences: number | null }) {
  const t = useTranslations("inbox");
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, "0");
  return (
    <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-300">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span>
        {sentences && sentences > 0 ? t("processingScenario", { n: sentences }) : t("processingHint")}
      </span>
      <span className="tabular-nums opacity-70">
        {mm}:{ss}
      </span>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <p className="text-sm">
      <span className="text-zinc-400">{label}: </span>
      {value}
    </p>
  );
}

function ComposePreview({ result }: { result: ComposeResult }) {
  const t = useTranslations("inbox");
  return (
    <div className="space-y-1">
      <p className="text-base font-medium">{result.target}</p>
      {result.ipa && <p className="text-xs text-zinc-500 font-mono">/{result.ipa}/</p>}
      <p className="text-sm text-zinc-500">{result.native}</p>
      <Field label={t("frame")} value={result.frame} />
      <Field label={t("literal")} value={result.literal} />
      <Field label={t("note")} value={result.note} />
      {result.variants.length > 0 && (
        <div className="text-sm">
          <span className="text-zinc-400">{t("variants")}: </span>
          {result.variants.join(" / ")}
        </div>
      )}
    </div>
  );
}

function GlossPreview({
  result,
  language,
  candidateIdx,
  onCandidateIdx,
}: {
  result: GlossResult;
  language: TargetLanguage;
  candidateIdx: number;
  onCandidateIdx: (i: number) => void;
}) {
  const t = useTranslations("inbox");
  const tv = useTranslations("vocab");
  const [collected, setCollected] = useState(false);

  async function collect() {
    const c = result.candidates[candidateIdx];
    if (!c) return;
    const meaning = [result.meaning, c.pos, c.note].filter(Boolean).join(" · ");
    await upsertVocab(language, c.target, meaning, [
      { sentenceId: null, islandId: null, text: result.example.target },
    ]);
    setCollected(true);
    window.setTimeout(() => setCollected(false), 2000);
  }

  return (
    <div className="space-y-2">
      <Field label={t("meaning")} value={result.meaning} />
      <div className="space-y-1">
        {result.candidates.map((c, i) => (
          <label key={`${c.target}-${i}`} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`cand-${result.meaning}`}
              checked={candidateIdx === i}
              onChange={() => onCandidateIdx(i)}
              className="mt-1"
            />
            <span>
              <span className="font-medium">{c.target}</span>
              {c.pos && <span className="text-zinc-400"> · {c.pos}</span>}
              {c.note && <span className="text-zinc-400"> · {c.note}</span>}
            </span>
          </label>
        ))}
      </div>
      <p className="text-sm">
        <span className="text-zinc-400">{t("example")}: </span>
        {result.example.target}
        <span className="text-zinc-400"> — {result.example.native}</span>
      </p>
      <button
        type="button"
        onClick={collect}
        className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-300"
      >
        {collected ? tv("collected") : tv("collect")}
      </button>
    </div>
  );
}
