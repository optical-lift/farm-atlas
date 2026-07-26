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

      const links = Array.from(home.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR));
      const current = links[0];
      if (!current) return;

      links.slice(1).forEach((link) => link.remove());

      current.href = "/paid-schedule";
      current.dataset.annaPaidScheduleLink = "true";
      current.classList.add("atlas-anna-paid-schedule-link");
      current.style.gridColumn = "1 / -1";
      current.setAttribute("aria-label", "Open Anna paid schedule");

      const title = current.querySelector("span");
      const detail = current.querySelector("em");
      if (title) title.textContent = "Paid schedule";
      if (detail) detail.textContent = "Started Jul 6 · Next pay Aug 31";

      if (current.dataset.annaPaidScheduleNavigation !== "true") {
        current.dataset.annaPaidScheduleNavigation = "true";
        current.addEventListener("click", (event) => {
          event.preventDefault();
          window.location.assign("/paid-schedule");
        });
      }
    }

    function scheduleApply() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(apply);
    }

    apply();
    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href", "class"] });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
