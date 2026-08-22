"use client";

import { useEffect } from "react";

function canonicalMowingLabel(title: string) {
  const routeLabel = title.replace(/^Mow\s*·\s*/i, "").trim();
  return routeLabel ? `Mowing · ${routeLabel}` : "";
}

export default function FutureMowPreviewTapBridge() {
  useEffect(() => {
    const openFutureMow = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest<HTMLElement>(".atlas-day-future-plan-card[data-future-projection-source='rhythm']");
      if (!card) return;
      const title = card.querySelector("strong")?.textContent?.trim() || "";
      if (!/^Mow\s*·/i.test(title)) return;
      const date = new URLSearchParams(window.location.search).get("date");
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

      const rhythmLabel = canonicalMowingLabel(title);
      if (!rhythmLabel) return;
      event.preventDefault();
      event.stopPropagation();
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/mow-preview?date=${encodeURIComponent(date)}&label=${encodeURIComponent(rhythmLabel)}&returnTo=${encodeURIComponent(returnTo)}`);
    };

    document.addEventListener("click", openFutureMow, true);
    return () => document.removeEventListener("click", openFutureMow, true);
  }, []);

  return null;
}
