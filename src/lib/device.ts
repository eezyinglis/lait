// Small browser/device helpers.

/** Current position, or null if denied, unavailable or slower than `timeoutMs`. Never throws. */
export function getPosition(timeoutMs = 4000): Promise<{ lat: number; lon: number } | null> {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) return resolve(null);
    const t = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      p => { clearTimeout(t); resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => { clearTimeout(t); resolve(null); },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 10 * 60 * 1000 },
    );
  });
}

/** True when running as an installed Home Screen app. */
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isPhone = () => isIOS() || /Android/.test(navigator.userAgent);

/**
 * Keeps the screen on while `enabled` (Screen Wake Lock API; iOS 16.4+ / modern browsers). The OS releases the
 * lock whenever the app goes to the background, so it is re-requested when the app becomes visible again.
 * Silently does nothing where unsupported.
 */
export function keepScreenOn(enabled: boolean): () => void {
  type Sentinel = { release: () => Promise<void> };
  const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock;
  if (!enabled || !wl) return () => {};
  let lock: Sentinel | null = null, stopped = false;
  const acquire = async () => {
    if (stopped || document.visibilityState !== 'visible') return;
    try { lock = await wl.request('screen'); } catch { /* denied or unsupported: ignore */ }
  };
  const onVis = () => { if (document.visibilityState === 'visible') void acquire(); };
  document.addEventListener('visibilitychange', onVis);
  void acquire();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVis);
    void lock?.release().catch(() => {});
  };
}

/** Public address of the app (works locally and on GitHub Pages). */
export const appUrl = () => location.origin + location.pathname;
