// Thin wrapper over the MediaSession API: lock-screen / notification transport
// controls + metadata, bound to the playback engine. Feature-detected — every
// call is a no-op where MediaSession is absent. No React.
//
// MediaSession binds to whatever media element last played in a user gesture,
// so the engine must keep ONE persistent element playing and call setup() after
// its first play(). Driving playback through that single element is what lets
// the lock screen stay in sync.

export interface MediaHandlers {
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
}

function ms(): MediaSession | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return null;
  }
  return navigator.mediaSession;
}

export function setupMediaSession(h: MediaHandlers): void {
  const s = ms();
  if (!s) return;
  const set = (action: MediaSessionAction, cb: (() => void) | null) => {
    try {
      s.setActionHandler(action, cb as MediaSessionActionHandler | null);
    } catch {
      /* unsupported action — ignore */
    }
  };
  set("play", h.onPlay);
  set("pause", h.onPause);
  set("previoustrack", h.onPrev);
  set("nexttrack", h.onNext);
  // Seek is meaningless for sentence shadowing; leave those handlers unset so
  // the OS hides the scrubber.
}

export function updateMediaMetadata(meta: {
  title: string;
  album: string;
  artist?: string;
}): void {
  const s = ms();
  if (!s || typeof MediaMetadata === "undefined") return;
  try {
    s.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist ?? "Echo",
      album: meta.album,
      artwork: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    });
  } catch {
    /* ignore */
  }
}

export function setPlaybackState(state: "playing" | "paused" | "none"): void {
  const s = ms();
  if (!s) return;
  try {
    s.playbackState = state;
  } catch {
    /* ignore */
  }
}

export function clearMediaSession(): void {
  const s = ms();
  if (!s) return;
  for (const a of ["play", "pause", "previoustrack", "nexttrack"] as const) {
    try {
      s.setActionHandler(a, null);
    } catch {
      /* ignore */
    }
  }
  try {
    s.metadata = null;
  } catch {
    /* ignore */
  }
  setPlaybackState("none");
}
