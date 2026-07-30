"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { AtlasPushCategory, AtlasPushPreferences, AtlasPushSetup } from "@/lib/atlas/push-contract";
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

const CATEGORY_LABELS: Array<{ key: AtlasPushCategory; label: string }> = [
  { key: "rhythm_warning", label: "Coming-due warnings" },
  { key: "rhythm_due", label: "Moves that become due" },
  { key: "rhythm_failure", label: "Rhythms that fall behind" },
  { key: "unlock", label: "Newly unlocked work" },
  { key: "owner_decision", label: "Owner decisions" },
  { key: "other_player_result", label: "Important results from another player" },
];

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
          ? "Farm Alerts are blocked in iPhone settings."
          : "Farm Alerts are not available in this browser.");
        return;
      }
      const baseSetup = setup ?? await fetchAtlasPushSetup();
      const connectedResult = await connectAtlasPush(baseSetup);
      setSetup(connectedResult.setup);
      setPreferences(connectedResult.setup.preferences);
      setSubscription(connectedResult.subscription);
      setQuietEnabled(Boolean(connectedResult.setup.preferences.quietStart && connectedResult.setup.preferences.quietEnd));
      setMessage("This iPhone is connected. A test alert is on its way.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Atlas could not connect Farm Alerts on this device.");
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
      setMessage("Farm Alerts are disconnected from this device.");
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
      setMessage("Test alert queued. It should arrive shortly even after you close Atlas.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Atlas could not send the test alert.");
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
        quietStart: quietEnabled ? preferences.quietStart || "21:00" : null,
        quietEnd: quietEnabled ? preferences.quietEnd || "07:00" : null,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || preferences.timeZone,
      };
      const nextSetup = await saveAtlasPushPreferences(nextPreferences);
      if (nextSetup) {
        setSetup(nextSetup);
        setPreferences(nextSetup.preferences);
      }
      setMessage("Farm Alert preferences saved.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Atlas could not save Farm Alert preferences.");
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
          <span>Farm Alerts</span>
          <b>{alertStatusLabel(state.permission, connected)}</b>
        </header>
        {alertsNeedInstallation ? (
          <p>Add Atlas to the Home Screen before enabling Farm Alerts on this iPhone or iPad.</p>
        ) : state.permission === "denied" ? (
          <p>Farm Alerts are blocked. Open iPhone Settings → Notifications → Atlas and allow notifications.</p>
        ) : state.permission === "unsupported" ? (
          <p>This browser does not offer Atlas notification delivery.</p>
        ) : connected ? (
          <>
            <p>This installed device is subscribed to calm, role-specific changes from the Bell.</p>
            <div className="atlas-pwa-inline-actions">
              <button type="button" onClick={() => void testAlerts()} disabled={working !== null}>
                {working === "test" ? "Sending…" : "Send test alert"}
              </button>
              <button type="button" className="quiet" onClick={() => void disconnectAlerts()} disabled={working !== null}>
                {working === "disconnect" ? "Disconnecting…" : "Disconnect device"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{state.permission === "granted"
              ? "Notification permission is allowed. Connect this iPhone to receive real Bell changes while Atlas is closed."
              : "Permission and device subscription are created only when you press the button."}</p>
            <button type="button" onClick={() => void connectAlerts()} disabled={!canRequestAlerts || working !== null || !setup}>
              {working === "connect" ? "Connecting…" : state.permission === "granted" ? "Connect Farm Alerts" : "Enable Farm Alerts"}
            </button>
          </>
        )}
      </section>

      {connected && preferences ? (
        <section className="atlas-pwa-setup-card atlas-push-preferences">
          <header>
            <span>Alert choices</span>
            <b>{preferences.enabled ? "On" : "Paused"}</b>
          </header>
          <label className="atlas-push-master">
            <input
              type="checkbox"
              checked={preferences.enabled}
              onChange={(event) => setPreferences({ ...preferences, enabled: event.target.checked })}
            />
            <span>Allow Atlas Farm Alerts</span>
          </label>
          <div className="atlas-push-category-list">
            {CATEGORY_LABELS.map((category) => (
              <label key={category.key}>
                <input
                  type="checkbox"
                  checked={preferences.categories[category.key]}
                  onChange={(event) => setPreferences({
                    ...preferences,
                    categories: { ...preferences.categories, [category.key]: event.target.checked },
                  })}
                />
                <span>{category.label}</span>
              </label>
            ))}
          </div>
          <label className="atlas-push-master">
            <input type="checkbox" checked={quietEnabled} onChange={(event) => setQuietEnabled(event.target.checked)} />
            <span>Use Atlas quiet hours</span>
          </label>
          {quietEnabled ? (
            <div className="atlas-push-quiet-hours">
              <label><span>From</span><input type="time" value={preferences.quietStart || "21:00"} onChange={(event) => setPreferences({ ...preferences, quietStart: event.target.value })} /></label>
              <label><span>Until</span><input type="time" value={preferences.quietEnd || "07:00"} onChange={(event) => setPreferences({ ...preferences, quietEnd: event.target.value })} /></label>
            </div>
          ) : null}
          <button type="button" onClick={() => void savePreferences()} disabled={working !== null}>
            {working === "preferences" ? "Saving…" : "Save alert choices"}
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
