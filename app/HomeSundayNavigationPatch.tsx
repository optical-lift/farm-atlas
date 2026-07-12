"use client";

import { useEffect } from "react";

function removeSundayFromHomeWeekLineup() {
  if (window.location.pathname !== "/") return;

  document
    .querySelectorAll<HTMLAnchorElement>(".atlas-home-overview-week .atlas-home-overview-list a")
    .forEach((link) => {
      const weekday = link.querySelector("strong")?.textContent?.trim().toLowerCase();
      if (weekday === "sun") link.remove();
    });
}

export default function HomeSundayNavigationPatch() {
  useEffect(() => {
    const apply = () => window.requestAnimationFrame(removeSundayFromHomeWeekLineup);
    const observer = new MutationObserver(apply);

    observer.observe(document.body, { childList: true, subtree: true });
    apply();

    return () => observer.disconnect();
  }, []);

  return null;
}
