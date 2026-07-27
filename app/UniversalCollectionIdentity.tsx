"use client";

import { useEffect } from "react";

function todayIso() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function addDaysIso(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function monthEndIso(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
  const local = new Date(end.getTime() - end.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function validDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function collectionWindow(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  const today = todayIso();

  if (pathname === "/day") {
    const date = validDate(params.get("date")) ? params.get("date") as string : today;
    return { doneDate: date, dueThrough: date };
  }

  if (pathname === "/overview/week") {
    const date = validDate(params.get("date")) ? params.get("date") as string : today;
    const dueThrough = validDate(params.get("end")) ? params.get("end") as string : addDaysIso(date, 6);
    return { doneDate: date, dueThrough };
  }

  if (pathname === "/overview/month") {
    const date = validDate(params.get("date")) ? params.get("date") as string : today;
    return { doneDate: date, dueThrough: monthEndIso(date) };
  }

  return null;
}

export default function UniversalCollectionIdentity() {
  useEffect(() => {
    const windowRange = collectionWindow(window.location.pathname, window.location.search);
    if (!windowRange) return;

    let cancelled = false;
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
        const applyIdentity = () => {
          document.querySelectorAll<HTMLElement>(".atlas-phone-title").forEach((title) => {
            if (result.portalLabel) title.textContent = result.portalLabel;
          });
          if (result.hasFarmScope === false) {
            const openCount = (result.taskCards ?? []).filter((task) => task.status === "open" || task.status === "blocked").length;
            document.querySelectorAll<HTMLElement>(".atlas-weather-line").forEach((status) => {
              status.textContent = `${openCount} open`;
            });
          }
          document.documentElement.dataset.atlasCollectionScope = result.hasFarmScope === false ? "organization" : "farm";
        };

        applyIdentity();
        window.requestAnimationFrame(applyIdentity);
      })
      .catch(() => {
        // The collection itself owns its visible error state.
      });

    return () => {
      cancelled = true;
      delete document.documentElement.dataset.atlasCollectionScope;
    };
  }, []);

  return null;
}
