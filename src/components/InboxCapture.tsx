"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { addToInbox } from "@/lib/inbox";
import type { InboxKind } from "@/lib/types";
import type { TargetLanguage } from "@/lib/api/contracts";
import { MicButton } from "./MicButton";

// 想说 captures Chinese; 想懂 captures the target language.
const NATIVE_BCP47 = "zh-CN";
const TARGET_BCP47: Record<TargetLanguage, string> = {
  de: "de-DE",
  en: "en-US",
};

// Language is fixed by the hub this lives under (no language toggle here).
export function InboxCapture({
  language,
  onCaptured,
}: {
  language: TargetLanguage;
  onCaptured?: () => void;
}) {
  const t = useTranslations("capture");

  const [kind, setKind] = useState<InboxKind>("say");
  const [text, setText] = useState("");
  const inputModeRef = useRef<"text" | "voice">("text");

  // Dictation language: 想懂 → the target tongue; 想说/场景 → Chinese.
  const dictationLang =
    kind === "understand" ? TARGET_BCP47[language] : NATIVE_BCP47;

  const placeholder =
    kind === "say"
      ? t("sayPlaceholder")
      : kind === "understand"
        ? t("understandPlaceholder")
        : t("scenarioPlaceholder");
  const hint =
    kind === "say" ? t("sayHint") : kind === "understand" ? t("understandHint") : t("scenarioHint");

  async function submit() {
    const raw = text.trim();
    if (!raw) return;
    // Capture is instant: local write, no network. Processing happens later.
    await addToInbox({ kind, language, rawText: raw, inputMode: inputModeRef.current });
    setText("");
    inputModeRef.current = "text";
    onCaptured?.();
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
      {/* kind toggle */}
      <div className="flex gap-2">
        {(["say", "understand", "scenario"] as InboxKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
              kind === k
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "border border-zinc-300 dark:border-zinc-700"
            }`}
          >
            {t(k)}
          </button>
        ))}
      </div>

      {/* text + mic */}
      <div className="flex items-start gap-2">
        <textarea
          value={text}
          onChange={(e) => {
            inputModeRef.current = "text";
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={2}
          placeholder={placeholder}
          className="flex-1 resize-none rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"
        />
        <MicButton
          lang={dictationLang}
          onText={(spoken) => {
            inputModeRef.current = "voice";
            setText(spoken);
          }}
        />
      </div>

      <p className="text-xs text-zinc-500">{hint}</p>

      <button
        type="button"
        onClick={submit}
        disabled={!text.trim()}
        className="w-full rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-40"
      >
        {t("submit")}
      </button>
    </section>
  );
}
