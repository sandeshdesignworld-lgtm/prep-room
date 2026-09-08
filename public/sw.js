/**
 * The service worker. Small on purpose.
 *
 * Its whole job is to make the app installable and to make the shell load
 * reliably. It is NOT a cache in front of the coach.
 *
 * The rule that shapes all of it: nothing about a conversation is ever stored
 * here, and nothing this app fetches from its own API is ever answered from
 * a cache. Not the advice, not the roleplay, not the debrief, not the cue
 * points, not the coach's voice, not the avatar's session token. Those are
 * live, personal, and in the token's case short-lived, and a stale one is
 * either a wrong answer or a broken session. They are not intercepted at all:
 * the request goes to the network exactly as if this file did not exist.
 *
 * What is cached is the shell and the static assets that never change without
 * changing their name.
 */

const VERSION = "v1";
const SHELL = `prime-ai-shell-${VERSION}`;
const ASSETS = `prime-ai-assets-${VERSION}`;

/** Enough to open the app offline and explain itself. */
const SHELL_URLS = ["/", "/privacy"];

/**
 * Paths that may be served from cache.
 *
 * Every one is content-addressed or genuinely static: Next's build output is
 * hashed, the icons and the models only change when the file changes. Nothing
 * user-specific is on this list and nothing ever should be.
 */
function isCacheableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/mediapipe/") ||
    url.pathname.startsWith("/_avatarkit/") ||
    url.pathname.startsWith("/assets/")
  );
}

/** Never touched, whatever else is true. */
function isLive(url) {
  return url.pathname.startsWith("/api/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // Individually, so one missing page cannot fail the whole install.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== SHELL && n !== ASSETS).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever GET, and only ever this origin. A POST is an action, not
  // something to replay, and another origin's caching is its own business.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The coach, the voice, the avatar's token. Straight past.
  if (isLive(url)) return;

  // A page. Network first, so a deploy is picked up immediately, with the
  // cached shell behind it so the app still opens on a train.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? (await caches.match("/")) ?? Response.error())
    );
    return;
  }

  if (!isCacheableAsset(url)) return;

  // Hashed or otherwise immutable, so the cached copy is the right copy and
  // there is nothing to revalidate.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(ASSETS).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
