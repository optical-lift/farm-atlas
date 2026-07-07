"use client";

import { useEffect } from "react";

export default function HomeTodayCompletePatch() {
  useEffect(() => {
    function polish() {
      if (window.location.pathname !== "/") return;
      const pill = document.querySelector<HTMLElement>(".atlas-home-task-hero .atlas-task-date");
      if (!pill) return;
      const value = pill.textContent?.trim() ?? "";
      if (value === "0/0" || value === "0 work") {
        pill.textContent = "Complete";
        pill.setAttribute("aria-label", "All tasks complete today");
      }
    }

    const observer = new MutationObserver(polish);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    polish();
    const timer = window.setInterval(polish, 400);
    window.setTimeout(() => window.clearInterval(timer), 5000);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
