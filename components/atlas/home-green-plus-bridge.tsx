"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const HOME_TRIGGER = '.atlas-topbar-action .atlas-note-plus[aria-label="Document work"]';
const GLOBAL_TRIGGER = 'button[aria-label="Add to Atlas"]';

export default function HomeGreenPlusBridge() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/") {
      delete document.body.dataset.atlasHomeAddTrigger;
      return;
    }

    function syncTriggerState() {
      if (document.querySelector(HOME_TRIGGER)) {
        document.body.dataset.atlasHomeAddTrigger = "true";
      } else {
        delete document.body.dataset.atlasHomeAddTrigger;
      }
    }

    function openGlobalAdd(event: MouseEvent) {
      const source = event.target instanceof Element
        ? event.target.closest(HOME_TRIGGER)
        : null;
      if (!source) return;

      const globalTrigger = document.querySelector(GLOBAL_TRIGGER);
      if (!(globalTrigger instanceof HTMLButtonElement)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      globalTrigger.click();
    }

    syncTriggerState();
    const observer = new MutationObserver(syncTriggerState);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", openGlobalAdd, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", openGlobalAdd, true);
      delete document.body.dataset.atlasHomeAddTrigger;
    };
  }, [pathname]);

  return null;
}
