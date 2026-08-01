"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type {
  AtlasPushCategory,
  AtlasPushCategoryPolicy,
  AtlasPushPreferences,
  AtlasPushSetup,
} from "@/lib/atlas/push-contract";
import {
  connectAtlasPush,
  currentAtlasPushSubscription,
  disconnectAtlasPush,
  fetchAtlasPushSetup,
  saveAtlasPushPreferences,
  sendAtlasPushTest,
} from "@/lib/atlas/push-client";
import {
  type AtlasBeforeInstallPromptEvent,
  atlasCanRequestNotifications,
  atlasIsIos,
  atlasIsSafari,
  atlasIsStandalone,
  atlasNotificationPermission,
  registerAtlasServiceWorker,
  requestAtlasNotificationPermission,
} from "@/lib/atlas/pwa-client";

const INSTALL_DISMISSED_KEY = "atlas:pwa-install-dismissed:v1";
const INSTALL_DISMISS_DAYS = 14;

const CATEGORY_ORDER: AtlasPushCategory[] = [
  "tomorrow_covered",
  "day_plan",
  "work_window",
  "dependency_ready",
  "task_nudge",
  "window_closing",
  "day_wrap",
  "rhythm_warning",
  "rhythm_due",
  "rhythm_failure",
  "unlock",
  "owner_decision",
  "other_player_result",
];

const FALLBACK_LABELS: Record<AtlasPushCategory, string> = {
  tomorrow_covered: "Tomorrow coverage",
  day_plan: "Morning plan",
  work_window: "Work ready now",
  dependency_ready: "Process timers and dependent work",
  task_nudge: "Friendly untouched reminders",
  window_closing: "Closing-window warnings",
  day_wrap: "End-of-day wrap-up",
  rhythm_warning: "Coming-due rhythm warnings",
  rhythm_due: "Rhythm work due now",
  rhythm_failure: "Missed rhythm boundaries",
  unlock: "Newly unlocked work",
  owner_decision: "Required handoffs and decisions",
  other_player_result: "Important results from another person",
};

const FALLBACK_POLICY: AtlasPushCategoryPolicy = {
  requiredCategories: [
    "work_window",
    "window_closing",
    "dependency_ready",
    "rhythm_due",
    "rhythm_failure",
    "unlock",
    "owner_decision",
  ],
  optionalCategories: ["day_plan", "task_nudge", "day_wrap", "rhythm_warning", "other_player_result"],
  canPauseAll: false,
  labels: FALLBACK_LABELS,
};

function recentDismissal() {
  try {
    const value = Number(window.localStorage.getItem(INSTALL_DISMISSED_KEY));
    return Number.isFinite(value) && Date.now() - value < INSTALL_DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now()));
  } catch {
    // Private browsing can deny local storage without affecting installation.
  }
}

function useAtlasPwaState() {
  const [hydrated, setHydrated] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [safari, setSafari] = useState(false);
  const [online, setOnline] = useState(true);
  const [serviceWorkerReady, setServiceWorkerReady] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<AtlasBeforeInstallPromptEvent | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => {
    setHydrated(true);
    setStandalone(atlasIsStandalone());
    setIos(atlasIsIos());
    setSafari(atlasIsSafari());
    setOnline(navigator.onLine);
    setPermission(atlasNotificationPermission());

    void registerAtlasServiceWorker()
      .then((registration) => setServiceWorkerReady(Boolean(registration)))
      .catch(() => setServiceWorkerReady(false));

    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as AtlasBeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setStandalone(true);
      setInstallPrompt(null);
    };
    const onConnection = () => setOnline(navigator.onLine);

    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onConnection);
    window.addEventListener("offline", onConnection);
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onConnection);
      window.removeEventListener("offline", onConnection);
    };
  }, []);

  return {
    hydrated,
    standalone,
    setStandalone,
    ios,
    safari,
    online,
    serviceWorkerReady,
    installPrompt,
    setInstallPrompt,
    permission,
    setPermission,
  };
}

async function runInstallPrompt(
  prompt: AtlasBeforeInstallPromptEvent,
  onFinished: (accepted: boolean) => void,
) {
  await prompt.prompt();
  const choice = await prompt.userChoice;
  onFinished(choice.outcome === "accepted");
}

export function AtlasPwaCoverPrompt() {
  const state = useAtlasPwaState();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (state.hydrated) setDismissed(recentDismissal());
  }, [state.hydrated]);

  const canGuideIos = state.ios && state.safari;
  if (!state.hydrated || state.standalone || dismissed) return null;
  if (!state.installPrompt && !canGuideIos) return null;

  function dismiss() {
    rememberDismissal();
    setDismissed(true);
  }

  return (
    <aside className="atlas-pwa-cover-prompt" aria-label="Install Atlas">
      <button type="button" className="atlas-pwa-dismiss" onClick={dismiss} aria-label="Dismiss install guidance">×</button>
      <span>Atlas app</span>
      <strong>Add Atlas to your Home Screen</strong>
      {canGuideIos ? (
        <p>Tap Safari’s Share button, then <b>Add to Home Screen</b>.</p>
      ) : (
        <p>Open Atlas without the browser frame and keep the last opened Day available when signal drops.</p>
      )}
      <div>
        {state.installPrompt ? (
          <button
            type="button"
            onClick={() => void runInstallPrompt(state.installPrompt!, (accepted) => {
              state.setInstallPrompt(null);
              if (accepted) state.setStandalone(true);
            })}
          >
            Install Atlas
          </button>
        ) : null}
        <Link href="/install">App setup</Link>
      </div>
    </aside>
  );
}

function installStatusLabel(standalone: boolean, installPrompt: AtlasBeforeInstallPromptEvent | null, ios: boolean) {
  if (standalone) return "Installed";
  if (installPrompt) return "Ready to install";
  if (ios) return "Use Safari Share";
  return "Browser install menu";
}

function alertStatusLabel(
  permission: NotificationPermission | "unsupported",
  connected: boolean,
) {
  if (permission === "denied") return "Blocked";
  if (permission === "unsupported") return "Unavailable";
  if (connected) return "Connected";
  if (permission === "granted") return "Needs connection";
  return "Not enabled";
}

function formatCoverageTime(value: string | null, timeZone: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

function orderedCategories(categories: AtlasPushCategory[]) {
  const included = new Set(categories);
  return CATEGORY_ORDER.filter((category) => included.has(category));
}

export default function AtlasPwaSetupPanel() {
  const state = useAtlasPwaState();
  const [working, setWorking] = useState<"install" | "connect" | "disconnect" | "test" | "preferences" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [setup, setSetup] = useState<AtlasPushSetup | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [preferences, setPreferences] = useState<AtlasPushPreferences | null>(null);
  const [quietEnabled, setQuietEnabled] = useState(false);

  const alertsNeedInstallation = state.ios && !state.standalone;
  const canRequestAlerts = useMemo(
    () => state.hydrated && atlasCanRequestNotifications() && !alertsNeedInstallation,
    [alertsNeedInstallation, state.hydrated],
  );
  const connected = Boolean(subscription && setup?.subscriptions.length);
  const policy = setup?.categoryPolicy ?? FALLBACK_POLICY;
  const requiredCategories = orderedCategories(policy.requiredCategories);
  const optionalCategories = orderedCategories(policy.optionalCategories);
  const coverage = setup?.tomorrowCoverage;
  const coverageTime = formatCoverageTime(coverage?.firstNotificationAt ?? null, preferences?.timeZone ?? "America/Chicago");

  useEffect(() => {
    if (!state.hydrated || alertsNeedInstallation) return;
    let active = true;
    void Promise.all([fetchAtlasPushSetup(), currentAtlasPushSubscription()])
      .then(([nextSetup, nextSubscription]) => {
        if (!active) return;
        setSetup(nextSetup);
        setSubscription(nextSubscription);
        setPreferences(nextSetup.preferences);
        setQuietEnabled(Boolean(nextSetup.preferences.quietStart && nextSetup.preferences.quietEnd));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [alertsNeedInstallation, state.hydrated]);

  async function install() {
    if (!state.installPrompt || working) return;
    setWorking("install");
    setMessage(null);
    try {
      await runInstallPrompt(state.installPrompt, (accepted) => {
        state.setInstallPrompt(null);
        if (accepted) state.setStandalone(true);
        setMessage(accepted ? "Atlas was added to this device." : "Installation was left unchanged.");
      });
    } finally {
      setWorking(null);
    }
  }

  async function connectAlerts() {
    if (!canRequestAlerts || working) return;
    setWorking("connect");
    setMessage(null);
    try {
      const nextPermission = await requestAtlasNotificationPermission();
      state.setPermission(nextPermission);
      if (nextPermission !== "granted") {
        setMessage(nextPermission === "denied"
          ? "Atlas notifications are blocked in iPhone settings."
          : "Atlas notifications are not available in this browser.");
        return;
      }
      const baseSetup = setup ?? await fetchAtlasPushSetup();
      const connectedResult = await connectAtlasPush(baseSetup);
      setSetup(connectedResult.setup);
      setPreferences(connectedResult.setup.preferences);
      setSubscription(connectedResult.subscription);
      setQuietEnabled(Boolean(connectedResult.setup.preferences.quietStart && connectedResult.setup.preferences.quietEnd));
      setMessage("This iPhone is connected. A test notification is on its way.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Atlas could not connect notifications on this device.");
    } finally {
      setWorking(null);
    }
  }

  async function disconnectAlerts() {
    if (!subscription || working) return;
    setWorking("disconnect");
    setMessage(null);
    try {
      const nextSetup = await disconnectAtlasPush(subscription);
      setSubscription(null);
      if (nextSetup) setSetup(nextSetup);
      setMessage("This device is disconnected. Atlas cannot deliver assigned work to its lockscreen.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Atlas could not disconnect this device.");
    } finally {
      setWorking(null);
    }
  }

  async function testAlerts() {
    if (!connected || working) return;
    setWorking("test");
    setMessage(null);
    try {
      const nextSetup = await sendAtlasPushTest();
      if (nextSetup) setSetup(nextSetup);
      setMessage("Test notification queued. It should arrive shortly even after you close Atlas.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Atlas could not send the test notification.");
    } finally {
      setWorking(null);
    }
  }

  async function savePreferences() {
    if (!preferences || working) return;
    setWorking("preferences");
    setMessage(null);
    try {
      const nextPreferences: AtlasPushPreferences = {
        ...preferences,
        enabled: true,
        quietStart: quietEnabled ? preferences.quietStart || "21:00" : null,
        quietEnd: quietEnabled ? preferences.quietEnd || "07:00" : null,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || preferences.timeZone,
      };
      const nextSetup = await saveAtlasPushPreferences(nextPreferences);
      if (nextSetup) {
        setSetup(nextSetup);
        setPreferences(nextSetup.preferences);
      }
      setMessage("Optional notification choices saved. Required work delivery remains on.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Atlas could not save notification choices.");
    } finally {
      setWorking(null);
    }
  }

  if (!state.hydrated) {
    return <div className="atlas-pwa-loading">Reading this device…</div>;
  }

  return (
    <div className="atlas-pwa-setup-grid">
      <section className="atlas-pwa-setup-card">
        <header>
          <span>Home Screen</span>
          <b>{installStatusLabel(state.standalone, state.installPrompt, state.ios)}</b>
        </header>
        {state.standalone ? (
          <p>Atlas is opening in standalone app mode.</p>
        ) : state.ios && state.safari ? (
          <ol>
            <li>Open Atlas in Safari.</li>
            <li>Tap the Share button.</li>
            <li>Choose <strong>Add to Home Screen</strong>, then Add.</li>
          </ol>
        ) : state.installPrompt ? (
          <>
            <p>Install Atlas for a full-screen Home Screen app.</p>
            <button type="button" onClick={install} disabled={working !== null}>
              {working === "install" ? "Opening…" : "Install Atlas"}
            </button>
          </>
        ) : (
          <p>Use this browser’s install or Add to Home Screen menu.</p>
        )}
      </section>

      <section className="atlas-pwa-setup-card">
        <header>
          <span>Lockscreen delivery</span>
          <b>{alertStatusLabel(state.permission, connected)}</b>
        </header>
        {alertsNeedInstallation ? (
          <p>Add Atlas to the Home Screen before enabling lockscreen delivery on this iPhone or iPad.</p>
        ) : state.permission === "denied" ? (
          <p>Atlas notifications are blocked. Open iPhone Settings → Notifications → Atlas and allow notifications.</p>
        ) : state.permission === "unsupported" ? (
          <p>This browser cannot receive Atlas lockscreen notifications.</p>
        ) : connected ? (
          <>
            <p>Atlas will deliver assigned work to this lockscreen when its real work window opens.</p>
            <div className="atlas-pwa-inline-actions">
              <button type="button" onClick={() => void testAlerts()} disabled={working !== null}>
                {working === "test" ? "Sending…" : "Send test notification"}
              </button>
              <button type="button" className="quiet" onClick={() => void disconnectAlerts()} disabled={working !== null}>
                {working === "disconnect" ? "Disconnecting…" : "Disconnect device"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{state.permission === "granted"
              ? "Notification permission is allowed. Connect this iPhone so Atlas can deliver the workday while the app is closed."
              : "Enable notifications so assigned work reaches this lockscreen at the right time."}</p>
            <button type="button" onClick={() => void connectAlerts()} disabled={!canRequestAlerts || working !== null || !setup}>
              {working === "connect" ? "Connecting…" : state.permission === "granted" ? "Connect lockscreen delivery" : "Enable Atlas notifications"}
            </button>
          </>
        )}
      </section>

      {setup ? (
        <section className="atlas-pwa-setup-card atlas-tomorrow-coverage">
          <header>
            <span>Tomorrow</span>
            <b>{coverage?.covered ? "Covered" : coverage?.taskCount ? "Needs attention" : "Clear"}</b>
          </header>
          {coverage?.covered ? (
            <p>
              <strong>Tomorrow is covered.</strong> {coverage.taskCount} task{coverage.taskCount === 1 ? "" : "s"} are staged across {coverage.momentCount} notification moments.
              {coverageTime ? ` First notification: ${coverageTime}.` : ""}
            </p>
          ) : coverage?.taskCount ? (
            <p>
              {coverage.deviceConnected
                ? `${coverage.uncoveredTaskCount} tomorrow task${coverage.uncoveredTaskCount === 1 ? " has" : "s have"} no work-window notification yet.`
                : "Tomorrow has assigned work, but this account has no connected notification device."}
            </p>
          ) : (
            <p>No assigned tasks are currently due tomorrow.</p>
          )}
        </section>
      ) : null}

      {connected && preferences ? (
        <section className="atlas-pwa-setup-card atlas-push-preferences">
          <header>
            <span>Notification delivery</span>
            <b>Required work stays on</b>
          </header>
          <p>Atlas must be able to tell you when assigned work becomes actionable or is about to miss its useful window.</p>

          <div className="atlas-push-category-list" aria-label="Required notification types">
            {requiredCategories.map((category) => (
              <label key={category}>
                <input type="checkbox" checked readOnly disabled />
                <span>{policy.labels[category] ?? FALLBACK_LABELS[category]} · Required</span>
              </label>
            ))}
          </div>

          {optionalCategories.length ? (
            <>
              <p><strong>Optional extras</strong></p>
              <div className="atlas-push-category-list" aria-label="Optional notification types">
                {optionalCategories.map((category) => (
                  <label key={category}>
                    <input
                      type="checkbox"
                      checked={preferences.categories[category] !== false}
                      onChange={(event) => setPreferences({
                        ...preferences,
                        categories: { ...preferences.categories, [category]: event.target.checked },
                      })}
                    />
                    <span>{policy.labels[category] ?? FALLBACK_LABELS[category]}</span>
                  </label>
                ))}
              </div>
            </>
          ) : null}

          <label className="atlas-push-master">
            <input type="checkbox" checked={quietEnabled} onChange={(event) => setQuietEnabled(event.target.checked)} />
            <span>Use quiet hours for optional notifications</span>
          </label>
          {quietEnabled ? (
            <div className="atlas-push-quiet-hours">
              <label><span>From</span><input type="time" value={preferences.quietStart || "21:00"} onChange={(event) => setPreferences({ ...preferences, quietStart: event.target.value })} /></label>
              <label><span>Until</span><input type="time" value={preferences.quietEnd || "07:00"} onChange={(event) => setPreferences({ ...preferences, quietEnd: event.target.value })} /></label>
            </div>
          ) : null}
          <p>Required process timers, work releases, and closing-window warnings may still arrive during quiet hours.</p>
          <button type="button" onClick={() => void savePreferences()} disabled={working !== null}>
            {working === "preferences" ? "Saving…" : "Save optional choices"}
          </button>
        </section>
      ) : null}

      <section className="atlas-pwa-setup-card">
        <header>
          <span>Field signal</span>
          <b>{state.online ? "Online" : "Offline"}</b>
        </header>
        <p>
          {state.serviceWorkerReady
            ? "Atlas keeps the last successfully opened Home, Day, Bell, and Journal views available when signal drops."
            : "Open Atlas once with a connection to prepare the offline shell on this device."}
        </p>
      </section>

      {message ? <p className="atlas-pwa-message" role="status">{message}</p> : null}
    </div>
  );
}
