"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DEFAULT_API_BASE,
  getApiBaseOverride,
  getApiToken,
  setApiBaseOverride,
  setApiToken,
} from "@/lib/settings";
import { ApiClientError, checkAuth, checkHealth } from "@/lib/api/client";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok" }
  | { kind: "fail"; detail: string };

export function SettingsView({ uiLocale }: { uiLocale: string }) {
  const t = useTranslations("settings");

  const [token, setToken] = useState("");
  const [base, setBase] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  // Hydrate from localStorage after mount (useState init can't — SSR sees no
  // localStorage and React reconciles against the SSR'd value).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot localStorage rehydration after mount
    setToken(getApiToken());
    setBase(getApiBaseOverride());
  }, []);

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

      <section className="space-y-5">
        <h2 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">
          {t("apiSection")}
        </h2>

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
      </section>
    </main>
  );
}
