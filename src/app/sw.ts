/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    // Seed JSON is versioned content that changes on deploy — always try the
    // network so a version bump is picked up immediately; fall back to cache
    // only when offline. (Avoids "deployed new islands but still see old ones".)
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname.startsWith("/seed/"),
      handler: new NetworkFirst({
        cacheName: "echo-seed",
        networkTimeoutSeconds: 5,
      }),
    },
    // Page navigations: fresh HTML when online, cached shell when offline — so a
    // new deploy shows up on reload without manually clearing the SW cache.
    {
      matcher: ({ request, sameOrigin }) =>
        sameOrigin && request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "echo-pages",
        networkTimeoutSeconds: 5,
      }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
