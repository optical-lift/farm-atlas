export type AtlasInstallChoice = {
  outcome: "accepted" | "dismissed";
  platform?: string;
};

export type AtlasBeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<AtlasInstallChoice>;
};

type AtlasNavigator = Navigator & {
  standalone?: boolean;
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

function browserNavigator() {
  return typeof navigator === "undefined" ? null : navigator as AtlasNavigator;
}

export function atlasIsStandalone() {
  if (typeof window === "undefined") return false;
  const mediaStandalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  return mediaStandalone || browserNavigator()?.standalone === true;
}

export function atlasIsIos() {
  const navigatorValue = browserNavigator();
  if (!navigatorValue) return false;
  return /iphone|ipad|ipod/i.test(navigatorValue.userAgent)
    || (navigatorValue.platform === "MacIntel" && navigatorValue.maxTouchPoints > 1);
}

export function atlasIsSafari() {
  const navigatorValue = browserNavigator();
  if (!navigatorValue) return false;
  const agent = navigatorValue.userAgent;
  return /safari/i.test(agent) && !/crios|fxios|edgios|chrome|android/i.test(agent);
}

export function atlasCanRequestNotifications() {
  return typeof window !== "undefined"
    && "Notification" in window
    && "serviceWorker" in navigator;
}

export function atlasNotificationPermission(): NotificationPermission | "unsupported" {
  if (!atlasCanRequestNotifications()) return "unsupported";
  return Notification.permission;
}

export async function registerAtlasServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return null;

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });

  void registration.update().catch(() => undefined);
  return registration;
}

export async function clearAtlasPrivateCaches() {
  const registration = await registerAtlasServiceWorker().catch(() => null);
  const worker = navigator.serviceWorker.controller
    || registration?.active
    || registration?.waiting
    || registration?.installing;
  worker?.postMessage({ type: "ATLAS_CLEAR_PRIVATE_CACHES" });
}

export async function setAtlasAppBadge(count: number) {
  const normalized = Math.max(0, Math.floor(Number(count) || 0));
  const navigatorValue = browserNavigator();
  if (!navigatorValue) return;

  try {
    if (normalized > 0 && typeof navigatorValue.setAppBadge === "function") {
      await navigatorValue.setAppBadge(normalized);
    } else if (normalized === 0 && typeof navigatorValue.clearAppBadge === "function") {
      await navigatorValue.clearAppBadge();
    }
  } catch {
    // The operating system may deny badge access independently of browser permission.
  }

  const registration = await registerAtlasServiceWorker().catch(() => null);
  const worker = navigator.serviceWorker.controller || registration?.active;
  worker?.postMessage({ type: "ATLAS_BADGE", count: normalized });
}

export async function requestAtlasNotificationPermission() {
  if (!atlasCanRequestNotifications()) return "unsupported" as const;
  await registerAtlasServiceWorker();
  if (Notification.permission === "granted") return "granted" as const;
  return Notification.requestPermission();
}
