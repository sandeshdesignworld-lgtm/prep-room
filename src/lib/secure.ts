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
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/** How to give this app the camera or the mic back, in the place it lives. */
export function allowAgainHint(device: "camera" | "mic"): string {
  return isStandalone()
    ? `Open your phone's settings for Prime AI and allow the ${device}, then come back.`
    : `Tap the padlock or the ${device === "camera" ? "camera" : "mic"} icon in the address bar and allow it, then reload.`;
}
