"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import {
  clearAtlasPrivateCaches,
  registerAtlasServiceWorker,
} from "@/lib/atlas/pwa-client";

const LOADED_BUILD_KEY = "atlas:loaded-build:v1";

type AtlasBuildVersionResponse = {
  ok?: boolean;
  buildVersion?: string;
};

function writeConnectionState() {
  document.documentElement.dataset.atlasConnection = navigator.onLine ? "online" : "offline";
  window.dispatchEvent(new CustomEvent("atlas:pwa-connection", {
    detail: { online: navigator.onLine },
  }));
}

function readLoadedBuild() {
  try {
    return window.sessionStorage.getItem(LOADED_BUILD_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function rememberLoadedBuild(buildVersion: string) {
  try {
    window.sessionStorage.setItem(LOADED_BUILD_KEY, buildVersion);
  } catch {
    // Private browsing can deny storage without preventing a live Atlas load.
  }
}

export default function AtlasPwaBridge() {
  const pathname = usePathname();
  const checkingBuild = useRef(false);
  const reloadingBuild = useRef(false);

  const refreshStaleBuild = useCallback(async () => {
    if (!navigator.onLine || checkingBuild.current || reloadingBuild.current) return;

    checkingBuild.current = true;
    try {
      const response = await fetch("/api/atlas/build-version", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return;
      const result = await response.json() as AtlasBuildVersionResponse;
      const currentBuild = result.buildVersion?.trim();
      if (!result.ok || !currentBuild || currentBuild === "development") return;

      const loadedBuild = readLoadedBuild();
      if (!loadedBuild) {
        rememberLoadedBuild(currentBuild);
        return;
      }
      if (currentBuild === loadedBuild) return;

      rememberLoadedBuild(currentBuild);
      reloadingBuild.current = true;
      window.location.reload();
    } catch {
      // A failed version probe must never replace Atlas with the offline shell.
    } finally {
      checkingBuild.current = false;
    }
  }, []);

  useEffect(() => {
    void registerAtlasServiceWorker().catch(() => undefined);
    writeConnectionState();
    void refreshStaleBuild();

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshStaleBuild();
    };
    const refreshNow = () => void refreshStaleBuild();

    window.addEventListener("online", writeConnectionState);
    window.addEventListener("offline", writeConnectionState);
    window.addEventListener("online", refreshNow);
    window.addEventListener("pageshow", refreshNow);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("online", writeConnectionState);
      window.removeEventListener("offline", writeConnectionState);
      window.removeEventListener("online", refreshNow);
      window.removeEventListener("pageshow", refreshNow);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshStaleBuild]);

  useEffect(() => {
    void refreshStaleBuild();
    if (pathname === "/login" || pathname.startsWith("/auth/")) {
      void clearAtlasPrivateCaches().catch(() => undefined);
    }
  }, [pathname, refreshStaleBuild]);

  return null;
}
