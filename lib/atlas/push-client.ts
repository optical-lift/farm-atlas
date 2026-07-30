import type { AtlasPushApiResponse, AtlasPushPreferences, AtlasPushSetup } from "@/lib/atlas/push-contract";
import { registerAtlasServiceWorker } from "@/lib/atlas/pwa-client";

function base64UrlBytes(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function responseJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({ ok: false, error: fallback })) as AtlasPushApiResponse;
  if (!response.ok || !data.ok) throw new Error(data.error || fallback);
  return data;
}

async function postPush(body: Record<string, unknown>, fallback: string) {
  const response = await fetch("/api/atlas/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-atlas-intent": "web-push-v1",
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  return responseJson(response, fallback);
}

export async function fetchAtlasPushSetup(): Promise<AtlasPushSetup> {
  const response = await fetch("/api/atlas/push", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const data = await responseJson(response, "Farm Alert setup could not be loaded.");
  if (!data.setup) throw new Error("Atlas returned an incomplete Farm Alert setup.");
  return data.setup;
}

export async function currentAtlasPushSubscription() {
  const registration = await registerAtlasServiceWorker();
  if (!registration || !("pushManager" in registration)) return null;
  return registration.pushManager.getSubscription();
}

export async function connectAtlasPush(setup: AtlasPushSetup) {
  if (!setup.vapidPublicKey) throw new Error("Atlas Farm Alerts are not configured yet.");
  const registration = await registerAtlasServiceWorker();
  if (!registration || !("pushManager" in registration)) {
    throw new Error("This installed browser does not support Farm Alerts.");
  }

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlBytes(setup.vapidPublicKey),
    });
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
  const result = await postPush({
    action: "register",
    subscription: subscription.toJSON(),
    deviceLabel: navigator.platform || "Installed Atlas device",
    userAgent: navigator.userAgent,
    timeZone,
    sendTest: true,
  }, "Atlas could not connect Farm Alerts on this device.");

  return { subscription, setup: result.setup ?? setup, result: result.result };
}

export async function disconnectAtlasPush(subscription: PushSubscription) {
  const result = await postPush({
    action: "revoke",
    endpoint: subscription.endpoint,
  }, "Atlas could not disconnect Farm Alerts on this device.");
  await subscription.unsubscribe().catch(() => false);
  return result.setup;
}

export async function sendAtlasPushTest() {
  const result = await postPush({ action: "test" }, "Atlas could not send the test alert.");
  return result.setup;
}

export async function saveAtlasPushPreferences(preferences: AtlasPushPreferences) {
  const quietEnabled = Boolean(preferences.quietStart && preferences.quietEnd);
  const result = await postPush({
    action: "preferences",
    enabled: preferences.enabled,
    categories: preferences.categories,
    quietEnabled,
    quietStart: preferences.quietStart,
    quietEnd: preferences.quietEnd,
    timeZone: preferences.timeZone,
  }, "Atlas could not save Farm Alert preferences.");
  return result.setup;
}
