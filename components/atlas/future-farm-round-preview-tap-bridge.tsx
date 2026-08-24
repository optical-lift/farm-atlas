"use client";

import { useEffect } from "react";

export default function FutureFarmRoundPreviewTapBridge() {
  useEffect(() => {
    const openFutureFarmRound = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest<HTMLElement>(".atlas-day-future-plan-card[data-future-projection-source='rhythm']");
      if (!card) return;

      const title = card.querySelector("strong")?.textContent?.trim() || "";
      if (!/^Farm Round$/i.test(title)) return;

      const date = new URLSearchParams(window.location.search).get("date");
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

      event.preventDefault();
      event.stopPropagation();
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/farm-round-preview?date=${encodeURIComponent(date)}&returnTo=${encodeURIComponent(returnTo)}`);
    };

    document.addEventListener("click", openFutureFarmRound, true);
    return () => document.removeEventListener("click", openFutureFarmRound, true);
  }, []);

  return null;
}
