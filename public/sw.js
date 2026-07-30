/* Atlas PWA shell. Canonical farm truth remains server-authoritative. */
const ATLAS_PWA_VERSION = "atlas-pwa-shell-v1";
const SHELL_CACHE = `${ATLAS_PWA_VERSION}:shell`;
const PAGE_CACHE = `${ATLAS_PWA_VERSION}:pages`;
const DATA_CACHE = `${ATLAS_PWA_VERSION}:prepared-data`;
const STATIC_CACHE = `${ATLAS_PWA_VERSION}:static`;
const PRIVATE_CACHES = [PAGE_CACHE, DATA_CACHE];

const SHELL_ASSETS = [
  "/offline",
  "/manifest.webmanifest",
  "/api/pwa/icon?size=192",
  "/api/pwa/icon?size=512",
];

const PREPARED_DATA_PATHS = [
  "/api/atlas/bell",
  "/api/atlas/home-task-cards",
  "/api/atlas/living-day",
  "/api/atlas/living-day-plan",
  "/api/atlas/operator-context",
  "/api/atlas/task-cards",
  "/api/atlas/trail-pulse",
  "/api/atlas/universal-task-cards",
  "/api/atlas/weather",
];

const CACHEABLE_PAGE_PREFIXES = [
  "/",
  "/bell",
  "/day",
  "/journal",
  "/objects/",
  "/overview/",
  "/project/",
  "/task-focus/",
  "/zones/",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_ASSETS.map(async (asset) => {
      try {
        await cache.add(new Request(asset, { cache: "reload", credentials: "same-origin" }));
      } catch {
        // One missing optional asset must not prevent the service worker from installing.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, PAGE_CACHE, DATA_CACHE, STATIC_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("atlas-pwa-") && !keep.has(key)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function isCacheablePage(pathname) {
  if (pathname === "/") return true;
  return CACHEABLE_PAGE_PREFIXES.some((prefix) => prefix !== "/" && pathname.startsWith(prefix));
}

function isPreparedData(pathname) {
  return PREPARED_DATA_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

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
    // Vary:* and transient browser cache failures should never break the live request.
  }
}

async function clearPrivateCaches() {
  await Promise.all(PRIVATE_CACHES.map((name) => caches.delete(name)));
}

async function fetchWithTimeout(request, milliseconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function latestCachedDay(cache) {
  const keys = await cache.keys();
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const url = new URL(keys[index].url);
    if (url.pathname === "/day") return cache.match(keys[index]);
  }
  return null;
}

async function navigationResponse(request) {
  const pageCache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetchWithTimeout(request, 5500);
    const finalUrl = new URL(response.url || request.url);
    if (finalUrl.pathname === "/login" || finalUrl.pathname.startsWith("/auth/")) {
      await clearPrivateCaches();
      return response;
    }
    if (responseCanBeCached(response) && isCacheablePage(finalUrl.pathname)) {
      await putQuietly(pageCache, request, response.clone());
    }
    return response;
  } catch {
    const exact = await pageCache.match(request);
    if (exact) return exact;

    const requestUrl = new URL(request.url);
    if (requestUrl.pathname === "/day") {
      const day = await latestCachedDay(pageCache);
      if (day) return day;
    }

    const home = await pageCache.match("/");
    if (home) return home;

    const shell = await caches.open(SHELL_CACHE);
    return (await shell.match("/offline")) || Response.error();
  }
}

async function preparedDataResponse(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetchWithTimeout(request, 4500);
    if (response.status === 401 || response.status === 403) {
      await clearPrivateCaches();
      return response;
    }
    if (responseCanBeCached(response)) await putQuietly(cache, request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || new Response(JSON.stringify({
      offline: true,
      cached: false,
      message: "No prepared Atlas record is cached for this view yet.",
    }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
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

  if (isPreparedData(url.pathname)) {
    event.respondWith(preparedDataResponse(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staticResponse(request));
  }
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
