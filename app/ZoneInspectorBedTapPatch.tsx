"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function objectKeyForButton(button: HTMLElement) {
  const wrapper = button.closest<HTMLElement>("[id^='object-']");
  return wrapper?.id.replace(/^object-/, "") ?? "";
}

export default function ZoneInspectorBedTapPatch() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/zones/")) return;

    const pending = new WeakMap<HTMLElement, number>();

    function scheduleFallback(button: HTMLElement) {
      const existing = pending.get(button);
      if (existing) window.clearTimeout(existing);

      const timer = window.setTimeout(() => {
        pending.delete(button);
        const card = button.closest<HTMLElement>(".atlas-bed-row-card");
        if (card?.classList.contains("open")) return;

        const objectKey = objectKeyForButton(button);
        if (objectKey) window.location.assign(`/objects/${encodeURIComponent(objectKey)}`);
      }, 180);

      pending.set(button, timer);
    }

    function handleInteraction(event: Event) {
      const target = event.target as Element | null;
      const button = target?.closest<HTMLElement>(".atlas-bed-row-button");
      if (!button) return;
      scheduleFallback(button);
    }

    document.addEventListener("click", handleInteraction, true);
    document.addEventListener("touchend", handleInteraction, true);

    return () => {
      document.removeEventListener("click", handleInteraction, true);
      document.removeEventListener("touchend", handleInteraction, true);
    };
  }, [pathname]);

  return null;
}
