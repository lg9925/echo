"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  addSentenceToIsland,
  getOrCreatePickedIsland,
  islandHref,
} from "@/lib/cards";
import {
  addVocab,
  deleteVocab,
  listVocab,
  updateVocab,
  vocabToCard,
} from "@/lib/vocab";
import { prewarmAudio } from "@/lib/tts";
import type { TargetLanguage } from "@/lib/api/contracts";
import type { VocabEntry } from "@/lib/types";

export function VocabView({
  uiLocale,
  language,
}: {
  uiLocale: string;
  language: TargetLanguage;
}) {
  const t = useTranslations("vocab");
  const [entries, setEntries] = useState<VocabEntry[] | null>(null);
  const [term, setTerm] = useState("");
  const [meaning, setMeaning] = useState("");

  const load = useCallback(async () => {
    setEntries(await listVocab(language));
  }, [language]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load after mount
    load();
  }, [load]);

  async function add() {
    if (!term.trim()) return;
    await addVocab({ language, term, meaning });
    setTerm("");
    setMeaning("");
    await load();
  }

  const onDeleted = useCallback((id: string) => {
    setEntries((es) => (es ? es.filter((e) => e.id !== id) : es));
  }, []);

  return (
    <main className="flex flex-1 flex-col gap-5 px-4 py-6 max-w-2xl mx-auto w-full">
      <header className="flex items-baseline justify-between gap-3">
        <a
          href={`/${uiLocale}/${language}/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          ← {t("back")}
        </a>
        <h1 className="text-lg font-medium">{t("title")}</h1>
        <span className="text-sm text-zinc-500 tabular-nums shrink-0">
          {entries ? t("count", { n: entries.length }) : ""}
        </span>
      </header>

      <div className="flex flex-wrap gap-2 items-end">
        <label className="flex-1 min-w-[8rem] space-y-1">
          <span className="text-xs text-zinc-500">{t("term")}</span>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t("termPlaceholder")}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex-1 min-w-[8rem] space-y-1">
          <span className="text-xs text-zinc-500">{t("meaning")}</span>
          <input
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={!term.trim()}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {t("add")}
        </button>
      </div>

      {entries && entries.length === 0 && (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      )}

      <ul className="space-y-3">
        {entries?.map((e) => (
          <li key={e.id}>
            <VocabRow
              entry={e}
              uiLocale={uiLocale}
              language={language}
              onDeleted={onDeleted}
            />
          </li>
        ))}
      </ul>
    </main>
  );
}

function VocabRow({
  entry,
  uiLocale,
  language,
  onDeleted,
}: {
  entry: VocabEntry;
  uiLocale: string;
  language: TargetLanguage;
  onDeleted: (id: string) => void;
}) {
  const t = useTranslations("vocab");
  const [meaning, setMeaning] = useState(entry.meaning);
  const [busy, setBusy] = useState(false);
  const [addedFlash, setAddedFlash] = useState(false);

  async function saveMeaning() {
    if (meaning === entry.meaning) return;
    await updateVocab(entry.id, { meaning: meaning.trim() });
  }

  async function addToLearning() {
    setBusy(true);
    const island = await getOrCreatePickedIsland(language, t("pickedIsland"));
    await addSentenceToIsland(island, vocabToCard({ ...entry, meaning }));
    void prewarmAudio(entry.term, language, 1);
    setBusy(false);
    setAddedFlash(true);
    window.setTimeout(() => setAddedFlash(false), 2000);
  }

  async function remove() {
    if (!window.confirm(t("confirmDelete"))) return;
    setBusy(true);
    await deleteVocab(entry.id);
    onDeleted(entry.id);
  }

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-2 bg-white dark:bg-zinc-950">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-medium">{entry.term}</span>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-xs text-zinc-400 hover:text-red-500 disabled:opacity-40 shrink-0"
        >
          {t("delete")}
        </button>
      </div>

      <input
        value={meaning}
        onChange={(e) => setMeaning(e.target.value)}
        onBlur={saveMeaning}
        placeholder={t("meaningPlaceholder")}
        className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-transparent px-2 py-1 text-sm text-zinc-600 dark:text-zinc-300"
      />

      {entry.refs.length > 0 && (
        <ul className="space-y-1">
          {entry.refs.map((r, i) => (
            <li key={i} className="text-xs text-zinc-500">
              {r.islandId ? (
                <a
                  href={islandHref(uiLocale, r.islandId)}
                  className="hover:underline underline-offset-4"
                >
                  {r.text || t("source")} →
                </a>
              ) : (
                <span>{r.text}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={addToLearning}
          disabled={busy}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-300 disabled:opacity-40"
        >
          {addedFlash ? t("added") : t("addToLearning")}
        </button>
      </div>
    </div>
  );
}
