"use client";

import { useEffect } from "react";

import {
  atlasFarmDateIso,
  atlasFarmMonthEnd,
  atlasNormalizeFarmDate,
  atlasShiftFarmDate,
} from "@/lib/atlas/farm-day";

function collectionWindow(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  const today = atlasFarmDateIso();

  if (pathname === "/day") {
    const date = atlasNormalizeFarmDate(params.get("date"), today);
    return { doneDate: date, dueThrough: date };
  }

  if (pathname === "/overview/week") {
    const date = atlasNormalizeFarmDate(params.get("date"), today);
    const dueThrough = atlasNormalizeFarmDate(params.get("end"), atlasShiftFarmDate(date, 6));
    return { doneDate: date, dueThrough };
  }

  if (pathname === "/overview/month") {
    const date = atlasNormalizeFarmDate(params.get("date"), today);
    return { doneDate: date, dueThrough: atlasFarmMonthEnd(date) };
  }

  return null;
}

export default function UniversalCollectionIdentity() {
  useEffect(() => {
    const windowRange = collectionWindow(window.location.pathname, window.location.search);
    if (!windowRange) return;

    let cancelled = false;
    let observer: MutationObserver | null = null;
    const params = new URLSearchParams(windowRange);
    fetch(`/api/atlas/universal-task-cards?${params.toString()}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((result: {
        ok?: boolean;
        portalLabel?: string;
        hasFarmScope?: boolean;
        taskCards?: Array<{ status?: string }>;
      }) => {
        if (cancelled || !result.ok) return;
        const openCount = (result.taskCards ?? []).filter((task) => task.status === "open" || task.status === "blocked").length;
        const applyIdentity = () => {
          document.querySelectorAll<HTMLElement>(".atlas-phone-title").forEach((title) => {
            if (result.portalLabel && title.textContent !== result.portalLabel) title.textContent = result.portalLabel;
          });
          if (result.hasFarmScope === false) {
            const label = `${openCount} open`;
            document.querySelectorAll<HTMLElement>(".atlas-weather-line").forEach((status) => {
              if (status.textContent !== label) status.textContent = label;
            });
          }
          document.documentElement.dataset.atlasCollectionScope = result.hasFarmScope === false ? "organization" : "farm";
        };

        applyIdentity();
        window.requestAnimationFrame(applyIdentity);
        observer = new MutationObserver(applyIdentity);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      })
      .catch(() => {
        // The collection itself owns its visible error state.
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      delete document.documentElement.dataset.atlasCollectionScope;
    };
  }, []);

  return null;
}
