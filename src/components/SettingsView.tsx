"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DEFAULT_API_BASE,
  DEFAULT_MAX_ISLAND_SENTENCES,
  MAX_ISLAND_SENTENCES,
  MIN_ISLAND_SENTENCES,
  getApiBaseOverride,
  getApiToken,
  getMaxIslandSentences,
  setApiBaseOverride,
  setApiToken,
  setMaxIslandSentences,
} from "@/lib/settings";
import {
  ApiClientError,
  checkAuth,
  checkHealth,
  getRouting,
  setRouting,
} from "@/lib/api/client";
import type {
  RoutingProviderInfo,
  RoutingState,
  RoutingTaskState,
} from "@/lib/api/contracts";
import {
  backupToBlob,
  exportBackup,
  importBackup,
  parseBackupFile,
  suggestedFilename,
  type ImportSummary,
} from "@/lib/backup";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok" }
  | { kind: "fail"; detail: string };

type BackupState =
  | { kind: "idle" }
  | { kind: "exporting" }
  | { kind: "importing" }
  | { kind: "imported"; summary: ImportSummary }
  | { kind: "error"; detail: string };

export function SettingsView({ uiLocale }: { uiLocale: string }) {
  const t = useTranslations("settings");

  const [token, setToken] = useState("");
  const [base, setBase] = useState("");
  const [maxSentences, setMaxSentences] = useState(DEFAULT_MAX_ISLAND_SENTENCES);
  const [savedFlash, setSavedFlash] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [backup, setBackup] = useState<BackupState>({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hydrate from localStorage after mount (useState init can't — SSR sees no
  // localStorage and React reconciles against the SSR'd value).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage rehydration after mount
    setToken(getApiToken());
    setBase(getApiBaseOverride());
    setMaxSentences(getMaxIslandSentences());
  }, []);

  function changeMax(n: number) {
    setMaxSentences(n);
    setMaxIslandSentences(n);
  }

  function save() {
    setApiToken(token);
    setApiBaseOverride(base);
    setSavedFlash(true);
    setTest({ kind: "idle" });
    window.setTimeout(() => setSavedFlash(false), 1500);
  }

  async function runTest() {
    setApiToken(token);
    setApiBaseOverride(base);
    setTest({ kind: "testing" });
    try {
      const reachable = await checkHealth();
      if (!reachable) {
        setTest({ kind: "fail", detail: t("unreachable") });
        return;
      }
      await checkAuth();
      setTest({ kind: "ok" });
    } catch (e) {
      const detail =
        e instanceof ApiClientError
          ? e.code === "no_token"
            ? t("needToken")
            : `${e.code} (${e.status})`
          : e instanceof Error
            ? e.message
            : String(e);
      setTest({ kind: "fail", detail });
    }
  }

  async function runExport() {
    setBackup({ kind: "exporting" });
    try {
      const file = await exportBackup();
      const blob = backupToBlob(file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedFilename(file);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackup({ kind: "idle" });
    } catch (e) {
      setBackup({ kind: "error", detail: e instanceof Error ? e.message : String(e) });
    }
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = ""; // allow re-importing the same file
    if (!file) return;
    setBackup({ kind: "importing" });
    try {
      const text = await file.text();
      const parsed = parseBackupFile(text);
      const summary = await importBackup(parsed);
      setBackup({ kind: "imported", summary });
    } catch (err) {
      setBackup({
        kind: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-8 px-6 py-12 max-w-2xl mx-auto w-full">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <a
          href={`/${uiLocale}/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          {t("back")}
        </a>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">
          {t("learningSection")}
        </h2>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("maxIsland")}</span>
          <select
            value={maxSentences}
            onChange={(e) => changeMax(Number(e.target.value))}
            className="block w-24 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
          >
            {Array.from(
              { length: MAX_ISLAND_SENTENCES - MIN_ISLAND_SENTENCES + 1 },
              (_, i) => MIN_ISLAND_SENTENCES + i,
            ).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">{t("maxIslandHint")}</span>
        </label>
      </section>

      <section className="space-y-5">
        <h2 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">
          {t("backupSection")}
        </h2>
        <p className="text-sm text-zinc-500">{t("backupHint")}</p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runExport}
            disabled={backup.kind === "exporting" || backup.kind === "importing"}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {backup.kind === "exporting" ? t("exporting") : t("export")}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={backup.kind === "exporting" || backup.kind === "importing"}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {backup.kind === "importing" ? t("importing") : t("import")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onImportFile}
            className="hidden"
          />
        </div>

        {backup.kind === "imported" && (
          <p className="text-sm text-green-600 dark:text-green-400">
            {t("importDone", {
              islands: backup.summary.islands,
              sentences: backup.summary.sentences,
              reviews: backup.summary.reviews,
            })}
          </p>
        )}
        {backup.kind === "error" && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {t("importError", { detail: backup.detail })}
          </p>
        )}
      </section>

      {/* Backend connection: developer/advanced, collapsed by default (原则一). */}
      <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
        <summary className="cursor-pointer select-none text-sm font-medium text-zinc-500">
          {t("advancedSection")}
        </summary>

        <div className="mt-5 space-y-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("apiToken")}</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t("apiTokenPlaceholder")}
              autoComplete="off"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
            />
            <span className="text-xs text-zinc-500">{t("apiTokenHint")}</span>
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("apiBase")}</span>
            <input
              type="text"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder={DEFAULT_API_BASE}
              autoComplete="off"
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono"
            />
            <span className="text-xs text-zinc-500">{t("apiBaseHint")}</span>
          </label>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium"
            >
              {savedFlash ? t("saved") : t("save")}
            </button>
            <button
              type="button"
              onClick={runTest}
              disabled={test.kind === "testing"}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {test.kind === "testing" ? t("testing") : t("testConnection")}
            </button>
          </div>

          {test.kind === "ok" && (
            <p className="text-sm text-green-600 dark:text-green-400">{t("testOk")}</p>
          )}
          {test.kind === "fail" && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {t("testFail", { detail: test.detail })}
            </p>
          )}

          <ModelRouting />
        </div>
      </details>
    </main>
  );
}

// Advanced: switch which provider+model serves each AI task. Changes apply live
// (the backend resolves routing per call) — no restart. Hidden inside the
// advanced section (原则一). Keys never leave the server; we only pick names.
function ModelRouting() {
  const t = useTranslations("settings");
  const [state, setState] = useState<RoutingState | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    try {
      setState(await getRouting());
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    // Needs a token; fails quietly if unset/unreachable (the section just hides).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot load after mount
    void load();
  }, []);

  if (error || !state) return null;

  return (
    <div className="space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-5">
      <div>
        <h3 className="text-sm font-medium">{t("routingSection")}</h3>
        <p className="text-xs text-zinc-500">{t("routingHint")}</p>
      </div>
      <div className="space-y-3">
        {state.tasks.map((task) => (
          <RoutingRow
            key={task.task}
            task={task}
            providers={state.providers}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}

function RoutingRow({
  task,
  providers,
  onChanged,
}: {
  task: RoutingTaskState;
  providers: RoutingProviderInfo[];
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations("settings");
  const CUSTOM = "__custom__";
  const DEFAULT = "__default__";
  // "default mode" = a provider override with no pinned model → resolves to the
  // provider's recommended default live (so it follows catalog updates). model
  // state of "" represents this; a non-empty string is a pinned model id.
  const startDefault = !!(
    task.override &&
    task.override.provider &&
    !task.override.model
  );
  const [provider, setProvider] = useState(task.provider);
  const [model, setModel] = useState(startDefault ? "" : task.model);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);

  const original = startDefault ? "" : task.model;
  const dirty = provider !== task.provider || model !== original;

  // Models to offer for the chosen provider (+ the current pinned one, so an
  // env/custom value is never hidden).
  const current = providers.find((p) => p.provider === provider);
  const modelOptions = current
    ? [...new Set([...current.models, ...(model ? [model] : [])])]
    : model
      ? [model]
      : [];

  function changeProvider(next: typeof provider) {
    setProvider(next);
    setCustom(false);
    setModel(""); // switching provider → use that provider's default
  }

  async function apply() {
    setBusy(true);
    try {
      await setRouting({ task: task.task, provider, model });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await setRouting({ task: task.task }); // clear override → env/default
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-24 shrink-0 text-zinc-600 dark:text-zinc-300">
        {t(`task_${task.task}`)}
      </span>
      <select
        value={provider}
        onChange={(e) => changeProvider(e.target.value as typeof provider)}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs"
      >
        {providers.map((p) => (
          <option key={p.provider} value={p.provider} disabled={!p.configured}>
            {p.provider}
            {p.configured ? "" : ` (${t("providerUnconfigured")})`}
          </option>
        ))}
      </select>
      <select
        value={custom ? CUSTOM : model === "" ? DEFAULT : model}
        onChange={(e) => {
          const v = e.target.value;
          if (v === CUSTOM) setCustom(true);
          else if (v === DEFAULT) {
            setCustom(false);
            setModel("");
          } else {
            setCustom(false);
            setModel(v);
          }
        }}
        className="min-w-0 flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
      >
        <option value={DEFAULT}>{t("routingDefaultModel")}</option>
        {modelOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value={CUSTOM}>{t("routingCustom")}</option>
      </select>
      {custom && (
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={t("routingCustomPlaceholder")}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs font-mono"
        />
      )}
      <button
        type="button"
        onClick={apply}
        disabled={busy || !dirty}
        className="rounded-md bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-2.5 py-1 text-xs font-medium disabled:opacity-40"
      >
        {t("routingApply")}
      </button>
      <button
        type="button"
        onClick={reset}
        disabled={busy || !task.overridden}
        className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-xs disabled:opacity-40"
      >
        {t("routingReset")}
      </button>
    </div>
  );
}
