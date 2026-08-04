/* Atlas PWA shell. Canonical farm truth remains server-authoritative. */
// This byte change refreshes the installed offline document with automatic recovery.
// Bump this version whenever the offline document or global app chrome changes.
// The version boundary forces installed devices to discard an older shell rather
// than preserving retired navigation in the field fallback.
const ATLAS_PWA_VERSION = "atlas-pwa-shell-v3";
const SHELL_CACHE = `${ATLAS_PWA_VERSION}:shell`;
const STATIC_CACHE = `${ATLAS_PWA_VERSION}:static`;
const PRIVATE_CACHE_SUFFIXES = [":pages", ":prepared-data"];

const SHELL_ASSETS = [
  "/offline",
  "/manifest.webmanifest",
  "/api/pwa/icon?size=192",
  "/api/pwa/icon?size=512",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_ASSETS.map(async (asset) => {
      try {
        await cache.add(new Request(asset, { cache: "reload", credentials: "same-origin" }));
      } catch {
        // One missing optional asset must not prevent the worker from installing.
      }
    }));
    await self.skipWaiting();
  })());
});

async function clearPrivateCaches() {
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith("atlas-pwa-") && PRIVATE_CACHE_SUFFIXES.some((suffix) => key.endsWith(suffix)))
    .map((key) => caches.delete(key)));
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("atlas-pwa-") && !keep.has(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/_next/image")
    || url.pathname.startsWith("/api/pwa/icon")
    || url.pathname === "/manifest.webmanifest"
    || /\.(?:css|js|woff2?|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname);
}

function responseCanBeCached(response) {
  return response && response.ok && (response.type === "basic" || response.type === "default");
}

async function putQuietly(cache, request, response) {
  try {
    await cache.put(request, response);
  } catch {
    // Browser cache failures must not break the live request.
  }
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    const finalUrl = new URL(response.url || request.url);
    if (finalUrl.pathname === "/login" || finalUrl.pathname.startsWith("/auth/")) {
      await clearPrivateCaches();
    }
    return response;
  } catch {
    const shell = await caches.open(SHELL_CACHE);
    return (await shell.match("/offline")) || Response.error();
  }
}

async function staticResponse(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const refreshed = fetch(request).then(async (response) => {
    if (responseCanBeCached(response)) await putQuietly(cache, request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await refreshed) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationResponse(request));
    return;
  }

  // Active Atlas data is deliberately never intercepted or cached. Home, Day,
  // task cards, and other work readers must always reflect server truth.
  if (url.pathname.startsWith("/api/atlas/")) return;

  if (isStaticAsset(url)) event.respondWith(staticResponse(request));
});

async function setAtlasBadge(value) {
  const count = Math.max(0, Number(value) || 0);
  const workerNavigator = self.navigator;
  try {
    if (count > 0 && typeof workerNavigator.setAppBadge === "function") {
      await workerNavigator.setAppBadge(count);
    } else if (count === 0 && typeof workerNavigator.clearAppBadge === "function") {
      await workerNavigator.clearAppBadge();
    }
  } catch {
    // Badging is optional and may be disabled at the operating-system level.
  }
}

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type === "ATLAS_SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  } else if (message.type === "ATLAS_CLEAR_PRIVATE_CACHES") {
    event.waitUntil(clearPrivateCaches());
  } else if (message.type === "ATLAS_BADGE") {
    event.waitUntil(setAtlasBadge(message.count));
  }
});

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch {
      payload = { body: event.data ? event.data.text() : "Farm movement is waiting in Atlas." };
    }

    const title = payload.title || "Atlas";
    const deepLink = payload.deepLink || payload.url || "/bell";
    const badgeCount = Number(payload.badgeCount || 0);

    await Promise.all([
      self.registration.showNotification(title, {
        body: payload.body || "Farm movement is waiting in the Bell.",
        icon: payload.icon || "/api/pwa/icon?size=192",
        badge: payload.badge || "/api/pwa/icon?size=192",
        tag: payload.tag || payload.dedupeKey || "atlas-farm-change",
        renotify: Boolean(payload.renotify),
        data: { deepLink, eventId: payload.eventId || null },
      }),
      setAtlasBadge(badgeCount),
    ]);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deepLink = event.notification.data && event.notification.data.deepLink
    ? event.notification.data.deepLink
    : "/bell";
  const destination = new URL(deepLink, self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("navigate" in client) await client.navigate(destination);
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow(destination);
  })());
});
