/**
 * Screen Wake Lock — hält Bildschirm & Tab wach, solange die Fabrik rendert
 * oder der Autopilot läuft. Die App braucht ohnehin den offenen Tab (das
 * Rendern passiert auf dessen Canvas) — der Wake Lock verhindert zusätzlich,
 * dass das Betriebssystem den Bildschirm währenddessen abdunkelt/sperrt.
 *
 * Unterstützt: Chrome/Edge/Opera (Desktop + Android), Safari ≥ 16.4,
 * Firefox ≥ 126. Fehlt die API (älterer Browser), passiert nichts Schlimmes —
 * die UI zeigt dann einen Hinweis, den Auto-Standby manuell auszuschalten.
 */

let sentinel: WakeLockSentinel | null = null;
let wanted = false;
let visibilityHandlerAttached = false;

export const wakeLockSupported = (): boolean =>
  typeof navigator !== "undefined" && "wakeLock" in navigator;

async function acquire(): Promise<boolean> {
  if (!wakeLockSupported()) return false;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
    return true;
  } catch {
    /* z.B. Tab im Hintergrund oder Nutzer-Policy — kein Drama, wir versuchen
     * es beim nächsten "visibilitychange" wieder. */
    sentinel = null;
    return false;
  }
}

function onVisibilityChange(): void {
  if (wanted && document.visibilityState === "visible" && !sentinel) {
    void acquire();
  }
}

/**
 * Fordert den Wake Lock an und hält ihn — auch über Tab-Wechsel hinweg: kehrt
 * der Tab in den Vordergrund zurück, wird automatisch neu angefordert (der
 * Browser gibt den Lock beim Verstecken selbst frei).
 */
export async function requestWakeLock(): Promise<boolean> {
  wanted = true;
  if (!visibilityHandlerAttached && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
    visibilityHandlerAttached = true;
  }
  if (sentinel && !sentinel.released) return true;
  return acquire();
}

export async function releaseWakeLock(): Promise<void> {
  wanted = false;
  const current = sentinel;
  sentinel = null;
  if (current && !current.released) {
    try {
      await current.release();
    } catch {
      /* schon weg — egal */
    }
  }
}

export const isWakeLockActive = (): boolean => Boolean(sentinel && !sentinel.released);
