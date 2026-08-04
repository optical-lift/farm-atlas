"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecoveryState = "waiting" | "checking" | "restoring";

function liveDestination() {
  const destination = new URL(window.location.href);
  destination.searchParams.delete("__atlas_reconnect");
  if (destination.pathname === "/offline") destination.pathname = "/";
  return destination;
}

export default function AtlasOfflineRecovery() {
  const [state, setState] = useState<RecoveryState>("waiting");
  const checking = useRef(false);

  const retry = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    setState("checking");

    const destination = liveDestination();
    const probe = new URL(destination);
    probe.searchParams.set("__atlas_reconnect", String(Date.now()));

    try {
      const response = await fetch(probe, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "text/html",
          "X-Atlas-Reconnect-Probe": "1",
        },
      });

      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("text/html")) {
        setState("waiting");
        return;
      }

      setState("restoring");
      window.location.replace(destination.href);
    } catch {
      setState("waiting");
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    document.body.dataset.atlasOfflineFallback = "true";

    const initial = window.setTimeout(() => void retry(), 500);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void retry();
    }, 5000);
    const resume = () => void retry();
    const visibility = () => {
      if (document.visibilityState === "visible") void retry();
    };

    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", visibility);

    return () => {
      delete document.body.dataset.atlasOfflineFallback;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [retry]);

  const message = state === "checking"
    ? "Checking the connection…"
    : state === "restoring"
      ? "Signal is back. Reopening Atlas…"
      : "Atlas will reopen automatically when the connection returns.";

  return (
    <div className="atlas-pwa-offline-recovery" data-state={state}>
      <button type="button" onClick={() => void retry()} disabled={state === "checking" || state === "restoring"}>
        Try again
      </button>
      <small role="status" aria-live="polite">{message}</small>
    </div>
  );
}
