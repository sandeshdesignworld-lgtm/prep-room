"use client";

/**
 * Whether this page is allowed to reach a camera and a microphone at all.
 *
 * Browsers only hand those out on a secure origin: HTTPS, or localhost. On
 * anything else `navigator.mediaDevices` is not merely refused, it is
 * undefined, and a service worker cannot register either. The usual way to
 * meet this is to open the app on a laptop's own IP address from a phone,
 * where the room comes up looking perfectly healthy and then quietly has no
 * camera, no microphone and no install prompt, with nothing on screen
 * explaining why.
 *
 * So it is checked, and said out loud.
 */
export function isSecure(): boolean {
  if (typeof window === "undefined") return true;
  return window.isSecureContext === true;
}

/** True when the browser has no media API to offer, secure or not. */
export function hasMediaDevices(): boolean {
  if (typeof navigator === "undefined") return false;
  return typeof navigator.mediaDevices?.getUserMedia === "function";
}

export const INSECURE_MESSAGE =
  "Your camera and microphone need a secure connection, and this page is not on one. Open the app over https and they will work. You can still type to your coach here.";

/**
 * Whether the app is running as an installed app rather than a browser tab.
 *
 * It changes what we are allowed to tell people. "Tap the padlock in the
 * address bar" is sound advice in Chrome and Safari and nonsense in an
 * installed app, which has no address bar at all: there the permission lives
 * in the phone's own settings. Getting this wrong sends someone hunting for a
 * control that is not on their screen.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS only, and only true in a home-screen app. Absent in every Android browser.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  if (iosStandalone) return true;
  // An Android Chrome TAB reports display-mode: browser, so this is false there,
  // which is what we want: that user does have an address bar to tap. Only the
  // address-bar-less modes count. "minimal-ui" deliberately does not: it keeps a
  // cut-down address bar, so the padlock advice still holds.
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches === true;
  const fullscreen = window.matchMedia?.("(display-mode: fullscreen)").matches === true;
  return standalone || fullscreen;
}

/** Which display-mode actually matched, for the on-device log. */
export function displayMode(): string {
  if (typeof window === "undefined" || !window.matchMedia) return "unknown";
  for (const mode of ["standalone", "fullscreen", "minimal-ui", "browser"]) {
    if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode;
  }
  return "unknown";
}

/**
 * Everything about this device that decides whether the camera can be asked
 * for, in one line, once.
 *
 * Deliberately not called from isSecure() or isStandalone(): those two are read
 * during render (one of them through useSyncExternalStore, which requires a
 * pure snapshot), and a console call in there both spams and breaks the rules.
 * This is called from the camera path instead, where it happens once per start.
 */
export function logMediaEnvironment(where: string): void {
  if (typeof window === "undefined") return;
  const activation = (navigator as { userActivation?: { hasBeenActive?: boolean; isActive?: boolean } })
    .userActivation;
  console.info(`[Prime AI media] ${where}`, {
    secureContext: window.isSecureContext,
    protocol: window.location.protocol,
    host: window.location.host,
    hasMediaDevices: hasMediaDevices(),
    displayMode: displayMode(),
    isStandalone: isStandalone(),
    // Chrome on Android refuses some requests outright when the page has never
    // been interacted with, and reports it here rather than in the error.
    userActivation: activation
      ? { hasBeenActive: activation.hasBeenActive, isActive: activation.isActive }
      : "unsupported",
    visibility: document.visibilityState,
    userAgent: navigator.userAgent,
  });
}

/** How to give this app the camera or the mic back, in the place it lives. */
export function allowAgainHint(device: "camera" | "mic"): string {
  return isStandalone()
    ? `Open your phone's settings for Prime AI and allow the ${device}, then come back.`
    : `Tap the padlock or the ${device === "camera" ? "camera" : "mic"} icon in the address bar and allow it, then reload.`;
}
