"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  isDictationSupported,
  startDictation,
  type DictationHandle,
} from "@/lib/speech";

// Shared voice-input button. Renders nothing when dictation is unsupported
// (iOS standalone PWA, Firefox, …) so capture degrades to typing.
export function MicButton({
  lang,
  onText,
}: {
  lang: string;
  onText: (text: string, isFinal: boolean) => void;
}) {
  const t = useTranslations("voice");
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const handleRef = useRef<DictationHandle | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot capability probe after mount
    setSupported(isDictationSupported());
  }, []);

  if (!supported) return null;

  function toggle() {
    if (listening) {
      handleRef.current?.stop();
      return;
    }
    setListening(true);
    handleRef.current = startDictation({
      lang,
      onResult: onText,
      onEnd: () => setListening(false),
      onError: () => setListening(false),
    });
    if (!handleRef.current) setListening(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={listening ? t("stop") : t("start")}
      title={listening ? t("listening") : t("start")}
      className={`shrink-0 rounded-lg border px-3 py-2 text-lg ${
        listening
          ? "border-red-500 text-red-500 animate-pulse"
          : "border-zinc-300 dark:border-zinc-700"
      }`}
    >
      {listening ? "■" : "🎤"}
    </button>
  );
}
