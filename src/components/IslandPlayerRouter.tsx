"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getIsland } from "@/lib/db";
import { ensureSeedLoaded } from "@/lib/seedLoader";
import type { Island } from "@/lib/types";
import { ShadowPlayer } from "@/components/ShadowPlayer";

// Reads ?id= from the URL (client-only, like ReviewSessionRouter) and plays
// that island. Used for user-created islands whose ids aren't known at build
// time. Sentences live in IndexedDB, so ShadowPlayer works the same as for
// seed islands once we resolve the island record.
export function IslandPlayerRouter({ uiLocale }: { uiLocale: string }) {
  const t = useTranslations("player");

  const [islandId] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("id") ?? "";
  });
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; island: Island }
    | { kind: "notfound" }
  >({ kind: "loading" });

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
        /* user islands don't depend on seed; ignore */
      }
      const island = await getIsland(islandId);
      if (!alive) return;
      setState(island ? { kind: "ready", island } : { kind: "notfound" });
    })();
    return () => {
      alive = false;
    };
  }, [islandId]);

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
        <p className="text-sm text-zinc-500">{t("empty")}</p>
        <a
          href={`/${uiLocale}/`}
          className="text-sm text-zinc-500 underline-offset-4 hover:underline"
        >
          {t("back")}
        </a>
      </main>
    );
  }

  return (
    <ShadowPlayer
      islandId={state.island.id}
      language={state.island.language}
      uiLocale={uiLocale}
      islandName={state.island.name}
    />
  );
}
