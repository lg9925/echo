"use client";

import { useEffect, useState } from "react";
import { ReviewSession } from "@/components/ReviewSession";
import { getIsland } from "@/lib/db";

const DEFAULT_TARGET_LANGUAGE = "de";

// Thin client wrapper: reads the target learning language from the URL
// (?lang=…) so a single static /review/ page can review any language.
// We read window.location.search directly (not useSearchParams) to avoid the
// Suspense / CSR-bailout constraints of static export — this is a pure-client PWA.
//
// The lazy initializer falls back to the default during server prerender (no
// window). No hydration mismatch: ReviewSession's first render is a
// language-independent loading state, so server and client HTML match.
export function ReviewSessionRouter({ uiLocale }: { uiLocale: string }) {
  const [language] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_TARGET_LANGUAGE;
    const lang = new URLSearchParams(window.location.search).get("lang");
    return lang ?? DEFAULT_TARGET_LANGUAGE;
  });
  // Optional island scope: ?island=<id> → review only that island.
  const [islandId] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("island") ?? "";
  });
  const [islandName, setIslandName] = useState("");
  useEffect(() => {
    if (!islandId) return;
    void getIsland(islandId).then((i) => {
      if (i) setIslandName(i.name);
    });
  }, [islandId]);

  return (
    <ReviewSession
      language={language}
      uiLocale={uiLocale}
      islandId={islandId || undefined}
      islandName={islandName || undefined}
    />
  );
}
