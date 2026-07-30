"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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

function permissionLabel(permission: NotificationPermission | "unsupported") {
  if (permission === "granted") return "Allowed";
  if (permission === "denied") return "Blocked";
  if (permission === "default") return "Not enabled";
  return "Unavailable";
}

export default function AtlasPwaSetupPanel() {
  const state = useAtlasPwaState();
  const [working, setWorking] = useState<"install" | "permission" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const alertsNeedInstallation = state.ios && !state.standalone;
  const canRequestAlerts = useMemo(
    () => state.hydrated && atlasCanRequestNotifications() && !alertsNeedInstallation,
    [alertsNeedInstallation, state.hydrated],
  );

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

  async function enableAlerts() {
    if (!canRequestAlerts || working) return;
    setWorking("permission");
    setMessage(null);
    try {
      const nextPermission = await requestAtlasNotificationPermission();
      state.setPermission(nextPermission);
      if (nextPermission === "granted") setMessage("Farm Alerts are allowed on this device.");
      if (nextPermission === "denied") setMessage("Farm Alerts are blocked in browser settings.");
      if (nextPermission === "unsupported") setMessage("Farm Alerts are not available in this browser.");
    } catch {
      setMessage("Atlas could not change alert permission on this device.");
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
          <b>{permissionLabel(state.permission)}</b>
        </header>
        {alertsNeedInstallation ? (
          <p>Add Atlas to the Home Screen before enabling Farm Alerts on this iPhone or iPad.</p>
        ) : state.permission === "granted" ? (
          <p>This device is allowed to show Atlas notifications. The Bell remains the complete alert history.</p>
        ) : state.permission === "denied" ? (
          <p>Farm Alerts are blocked. Change Atlas notification permission in the device or browser settings.</p>
        ) : state.permission === "unsupported" ? (
          <p>This browser does not offer Atlas notification permission.</p>
        ) : (
          <>
            <p>Permission is requested only when you press the button.</p>
            <button type="button" onClick={enableAlerts} disabled={!canRequestAlerts || working !== null}>
              {working === "permission" ? "Requesting…" : "Enable Farm Alerts"}
            </button>
          </>
        )}
      </section>

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
