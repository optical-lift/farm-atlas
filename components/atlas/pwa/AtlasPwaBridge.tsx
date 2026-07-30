"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import {
  clearAtlasPrivateCaches,
  registerAtlasServiceWorker,
} from "@/lib/atlas/pwa-client";

function writeConnectionState() {
  document.documentElement.dataset.atlasConnection = navigator.onLine ? "online" : "offline";
  window.dispatchEvent(new CustomEvent("atlas:pwa-connection", {
    detail: { online: navigator.onLine },
  }));
}

export default function AtlasPwaBridge() {
  const pathname = usePathname();

  useEffect(() => {
    void registerAtlasServiceWorker().catch(() => undefined);
    writeConnectionState();

    window.addEventListener("online", writeConnectionState);
    window.addEventListener("offline", writeConnectionState);
    return () => {
      window.removeEventListener("online", writeConnectionState);
      window.removeEventListener("offline", writeConnectionState);
    };
  }, []);

  useEffect(() => {
    if (pathname === "/login" || pathname.startsWith("/auth/")) {
      void clearAtlasPrivateCaches().catch(() => undefined);
    }
  }, [pathname]);

  return null;
}
