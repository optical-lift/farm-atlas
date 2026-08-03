"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const MIN_REFRESH_INTERVAL_MS = 1_500;

/**
 * Next's client router can restore a previously rendered Home payload when the
 * user returns from Work. Farm assignments and availability are live data, so
 * Home must immediately reconcile that restored payload with the server.
 */
export default function AtlasHomeServerRefresh() {
  const router = useRouter();
  const lastRefreshAt = useRef(0);

  useEffect(() => {
    function refreshFromServer() {
      const now = Date.now();
      if (now - lastRefreshAt.current < MIN_REFRESH_INTERVAL_MS) return;
      lastRefreshAt.current = now;
      router.refresh();
    }

    const initialRefresh = window.setTimeout(refreshFromServer, 0);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshFromServer();
    };
    const handlePageShow = () => refreshFromServer();

    window.addEventListener("focus", refreshFromServer);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("focus", refreshFromServer);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router]);

  return null;
}
