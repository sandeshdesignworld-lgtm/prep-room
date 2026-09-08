"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, and nothing else.
 *
 * Deliberately silent: there is no update prompt, no offline banner, no toast.
 * A new version is picked up on the next load, because the worker claims its
 * clients as soon as it activates, and interrupting someone mid-rehearsal to
 * tell them about a deploy would be worse than the deploy.
 *
 * Development is left alone. A worker caching a shell that Next is rebuilding
 * every few seconds is a way to spend an afternoon wondering why a change did
 * not appear.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        // Not fatal: without it the app still works, it just is not installable.
        console.error("[Prime AI] the service worker did not register.", err);
      });
    };

    // After load, so it never competes with the first paint or the models.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
