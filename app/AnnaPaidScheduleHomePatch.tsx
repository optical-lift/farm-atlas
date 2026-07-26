"use client";

import { useEffect } from "react";

const HOME_SELECTOR = '[data-atlas-home-portal="shared"][data-atlas-viewer-worker="anna"]';
const LINK_SELECTOR = ".atlas-home-closeout-footer-link";

export default function AnnaPaidScheduleHomePatch() {
  useEffect(() => {
    let frame = 0;

    function apply() {
      const home = document.querySelector<HTMLElement>(HOME_SELECTOR);
      if (!home) return;

      const current = home.querySelector<HTMLAnchorElement>(LINK_SELECTOR);
      if (!current || current.dataset.annaPaidScheduleLink === "true") return;

      const replacement = current.cloneNode(true) as HTMLAnchorElement;
      replacement.href = "/paid-schedule";
      replacement.dataset.annaPaidScheduleLink = "true";
      replacement.setAttribute("aria-label", "Open Anna paid schedule");

      const title = replacement.querySelector("span");
      const detail = replacement.querySelector("em");
      if (title) title.textContent = "Paid schedule";
      if (detail) detail.textContent = "Started Jul 6 · Next pay Aug 31";

      replacement.addEventListener("click", (event) => {
        event.preventDefault();
        window.location.assign("/paid-schedule");
      });

      current.replaceWith(replacement);
    }

    function scheduleApply() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(apply);
    }

    apply();
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
