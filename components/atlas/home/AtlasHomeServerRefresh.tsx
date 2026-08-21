"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const STALE_AFTER_BACKGROUND_MS = 30_000;
const MIN_REFRESH_INTERVAL_MS = 5_000;

/**
 * Normal client navigation to Home already receives a fresh server payload.
 * Reconcile only when the browser restores Home from bfcache or after Atlas has
 * actually been backgrounded long enough for operational truth to become stale.
 */
export default function AtlasHomeServerRefresh() {
  const router = useRouter();
  const lastRefreshAt = useRef(0);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    function refreshFromServer() {
      const now = Date.now();
      if (now - lastRefreshAt.current < MIN_REFRESH_INTERVAL_MS) return;
      lastRefreshAt.current = now;
      router.refresh();
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        hiddenAt.current = Date.now();
        return;
      }
      const backgroundedAt = hiddenAt.current;
      hiddenAt.current = null;
      if (backgroundedAt && Date.now() - backgroundedAt >= STALE_AFTER_BACKGROUND_MS) refreshFromServer();
    }

    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) refreshFromServer();
    }

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [router]);

  return null;
}
