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

/** Public address of the app (works locally and on GitHub Pages). */
export const appUrl = () => location.origin + location.pathname;
