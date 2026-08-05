/* Atlas PWA shell. Canonical farm truth remains server-authoritative. */
// This byte change refreshes the installed offline document and any open stale client.
// Bump this version whenever the offline document or global app chrome changes.
// v10 refreshes installed clients after removing the remaining Day timeline backplates.
const ATLAS_PWA_VERSION = "atlas-pwa-shell-v10";
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

async function reloadOpenAtlasClients() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  await Promise.all(windows.map(async (client) => {
    if (!("navigate" in client)) return;
    try {
      await client.navigate(client.url);
    } catch {
      // A client can close between matchAll and navigate without blocking activation.
    }
  }));
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
    const keys = await caches.keys();
    const replacingEarlierShell = keys.some((key) => key.startsWith("atlas-pwa-") && !keep.has(key));
    await Promise.all(keys
      .filter((key) => key.startsWith("atlas-pwa-") && !keep.has(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
    if (replacingEarlierShell) await reloadOpenAtlasClients();
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

async function finishNavigationResponse(response, requestUrl) {
  const finalUrl = new URL(response.url || requestUrl);
  if (finalUrl.pathname === "/login" || finalUrl.pathname.startsWith("/auth/")) {
    await clearPrivateCaches();
  }
  return response;
}

async function navigationResponse(request) {
  try {
    return await finishNavigationResponse(await fetch(request), request.url);
  } catch {
    try {
      const retry = new Request(request.url, {
        method: "GET",
        headers: request.headers,
        credentials: "same-origin",
        cache: "reload",
        redirect: "follow",
      });
      return await finishNavigationResponse(await fetch(retry), request.url);
    } catch {
      const shell = await caches.open(SHELL_CACHE);
      return (await shell.match("/offline")) || Response.error();
    }
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

function taskNotificationActions(payload) {
  const momentId = typeof payload.taskNotificationMomentId === "string"
    ? payload.taskNotificationMomentId
    : "";
  const taskIds = Array.isArray(payload.taskIds)
    ? payload.taskIds.filter((taskId) => typeof taskId === "string")
    : [];

  if (!momentId || !taskIds.length) return [];

  const actions = [];
  if (taskIds.length === 1) actions.push({ action: "done", title: "Done" });
  actions.push({ action: "snooze-5h", title: "Remind in 5h" });
  return actions;
}

async function showAtlasNotification(title, options) {
  try {
    await self.registration.showNotification(title, options);
  } catch {
    // Some Web Push surfaces accept the notification but not action buttons.
    // Retrying without actions keeps the notification body tap dependable.
    const fallback = { ...options };
    delete fallback.actions;
    await self.registration.showNotification(title, fallback);
  }
}

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
    const taskIds = Array.isArray(payload.taskIds)
      ? payload.taskIds.filter((taskId) => typeof taskId === "string")
      : [];
    const actions = taskNotificationActions(payload);

    await Promise.all([
      showAtlasNotification(title, {
        body: payload.body || "Farm movement is waiting in the Bell.",
        icon: payload.icon || "/api/pwa/icon?size=192",
        badge: payload.badge || "/api/pwa/icon?size=192",
        tag: payload.tag || payload.dedupeKey || "atlas-farm-change",
        renotify: Boolean(payload.renotify),
        actions,
        data: {
          deepLink,
          eventId: payload.eventId || null,
          taskNotificationMomentId: payload.taskNotificationMomentId || null,
          taskIds,
          badgeCount,
        },
      }),
      setAtlasBadge(badgeCount),
    ]);
  })());
});

async function openAtlasDestination(deepLink) {
  const destination = new URL(deepLink || "/bell", self.location.origin).href;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if ("navigate" in client) await client.navigate(destination);
    if ("focus" in client) return client.focus();
  }
  return self.clients.openWindow(destination);
}

async function postNotificationAction(data, action) {
  const response = await fetch("/api/atlas/notification-action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "notification-action-v1",
    },
    credentials: "include",
    cache: "no-store",
    body: JSON.stringify({
      notificationMomentId: data.taskNotificationMomentId,
      action,
      delayMinutes: action === "snooze" ? 300 : undefined,
    }),
  });

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok || !result || !result.ok) throw new Error("Atlas notification action failed.");
  return result;
}

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const deepLink = data.deepLink || "/bell";
  const selectedAction = event.action || "open";
  event.notification.close();

  if (selectedAction === "done" || selectedAction === "snooze-5h") {
    event.waitUntil((async () => {
      try {
        const result = await postNotificationAction(
          data,
          selectedAction === "done" ? "done" : "snooze",
        );
        if (result.requiresOpen) {
          return openAtlasDestination(result.deepLink || deepLink);
        }
        if (selectedAction === "done") {
          await setAtlasBadge(Math.max(0, Number(data.badgeCount || 1) - 1));
        }
        return undefined;
      } catch {
        // Authentication, an expired task, or a structured result can require
        // the full Atlas surface. Opening the task is the safe fallback.
        return openAtlasDestination(deepLink);
      }
    })());
    return;
  }

  event.waitUntil(openAtlasDestination(deepLink));
});
