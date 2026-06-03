"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiFetchJson, apiFetchSSE } from "@/lib/api/client";
import {
  addSentencesToIsland,
  createScenarioIsland,
  islandHref,
  scenarioToFieldsList,
} from "@/lib/cards";
import { profileForRequest } from "@/lib/profile";
import type {
  AskResult,
  ScenarioResult,
  TargetLanguage,
} from "@/lib/api/contracts";
import { MicButton } from "./MicButton";

type Turn =
  | { role: "user"; text: string }
  | { role: "answer"; text: string }
  | { role: "island"; islandId: string; islandName: string }
  | { role: "error"; text: string };

const LANGS: TargetLanguage[] = ["de", "en"];

// Always-on assistant: describe a scene → generate an island, or ask a question.
// Mounted globally in the locale layout. Reuses the existing scenario stream +
// the new /v1/ask task. Session-only thread (the valuable output — islands —
// persists in IndexedDB).
export function Assistant() {
  const t = useTranslations("assistant");
  const pathname = usePathname();
  const seg = pathname.split("/");
  const uiLocale = seg[1] === "en" ? "en" : "zh";
  const routeLang = seg[2] === "en" ? "en" : seg[2] === "de" ? "de" : null;

  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<TargetLanguage>(routeLang ?? "de");
  const [mode, setMode] = useState<"island" | "ask">("island");
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setTurns((ts) => [...ts, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      if (mode === "ask") {
        const r = await apiFetchJson<AskResult>("/v1/ask", {
          language: lang,
          question: text,
          profile: profileForRequest(lang),
        });
        setTurns((ts) => [...ts, { role: "answer", text: r.answer }]);
      } else {
        setProgress(0);
        const r = await apiFetchSSE<ScenarioResult>(
          "/v1/scenario/stream",
          { language: lang, description: text, profile: profileForRequest(lang) },
          (data) => {
            const p = data as { sentences?: number };
            if (typeof p.sentences === "number") setProgress(p.sentences);
          },
        );
        const island = await createScenarioIsland(lang, r.islandName);
        await addSentencesToIsland(island, scenarioToFieldsList(r.sentences));
        setTurns((ts) => [
          ...ts,
          { role: "island", islandId: island.id, islandName: island.name },
        ]);
      }
    } catch (e) {
      setTurns((ts) => [
        ...ts,
        { role: "error", text: e instanceof Error ? e.message : String(e) },
      ]);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("title")}
        title={t("title")}
        className="fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-lg text-xl flex items-center justify-center hover:scale-105 transition-transform"
      >
        ✨
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col w-[min(92vw,24rem)] h-[min(80vh,32rem)] rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
        <span className="text-sm font-medium">{t("title")}</span>
        <div className="flex items-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as TargetLanguage)}
            className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-transparent px-1.5 py-1 text-xs"
          >
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("close")}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-1"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="flex gap-1 px-3 pt-2">
        {(["island", "ask"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium ${
              mode === m
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-200 dark:border-zinc-800 text-zinc-500"
            }`}
          >
            {m === "island" ? t("modeIsland") : t("modeAsk")}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-4 py-3 space-y-3 text-sm">
        {turns.length === 0 && (
          <p className="text-zinc-400">
            {mode === "island" ? t("islandHint") : t("askHint")}
          </p>
        )}
        {turns.map((turn, i) => {
          if (turn.role === "user") {
            return (
              <p key={i} className="text-right">
                <span className="inline-block rounded-2xl bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5">
                  {turn.text}
                </span>
              </p>
            );
          }
          if (turn.role === "answer") {
            return (
              <p key={i} className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {turn.text}
              </p>
            );
          }
          if (turn.role === "island") {
            return (
              <p key={i} className="text-zinc-700 dark:text-zinc-300">
                {t("islandDone", { name: turn.islandName })}{" "}
                <a
                  href={islandHref(uiLocale, turn.islandId)}
                  className="text-blue-600 dark:text-blue-400 hover:underline underline-offset-4"
                >
                  {t("goPractice")}
                </a>
              </p>
            );
          }
          return (
            <p key={i} className="text-red-600 dark:text-red-400">
              {turn.text}
            </p>
          );
        })}
        {busy && (
          <p className="text-zinc-400">
            {mode === "island"
              ? t("generating", { n: progress ?? 0 })
              : t("thinking")}
          </p>
        )}
      </div>

      <div className="flex items-end gap-2 p-3 border-t border-zinc-100 dark:border-zinc-800">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={mode === "island" ? t("islandPlaceholder") : t("askPlaceholder")}
          rows={2}
          className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm resize-none"
        />
        <MicButton lang="zh-CN" onText={(text) => setInput(text)} />
        <button
          type="button"
          onClick={send}
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-40"
        >
          {t("send")}
        </button>
      </div>
    </div>
  );
}
