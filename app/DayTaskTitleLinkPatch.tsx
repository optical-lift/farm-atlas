"use client";

import { useEffect } from "react";

const TITLE_SELECTOR = ".atlas-journal-task-row > summary > strong";
const TASK_LINK_SELECTOR = ".atlas-journal-task-detail > a[href]";

function openTask(title: Element) {
  const row = title.closest(".atlas-journal-task-row");
  const link = row?.querySelector<HTMLAnchorElement>(TASK_LINK_SELECTOR);
  if (!link) return false;
  window.location.assign(link.href);
  return true;
}

export default function DayTaskTitleLinkPatch() {
  useEffect(() => {
    function prepareTitles(root: ParentNode = document) {
      root.querySelectorAll<HTMLElement>(TITLE_SELECTOR).forEach((title) => {
        title.setAttribute("role", "link");
        title.tabIndex = 0;
        title.setAttribute("aria-label", `Open ${title.textContent?.trim() || "task"}`);
      });
    }

    function handleClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target.closest(TITLE_SELECTOR) : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      openTask(target);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target instanceof Element ? event.target.closest(TITLE_SELECTOR) : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      openTask(target);
    }

    prepareTitles();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) prepareTitles(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return null;
}
