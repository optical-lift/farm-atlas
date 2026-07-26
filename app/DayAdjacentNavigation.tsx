"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function localTodayIso() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function shiftIsoDate(dateIso: string, days: number) {
  const date = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function currentDayDate() {
  const params = new URLSearchParams(window.location.search);
  return params.get("date") || localTodayIso();
}

export default function DayAdjacentNavigation() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [dateIso, setDateIso] = useState(localTodayIso());

  useEffect(() => {
    if (window.location.pathname !== "/day") return;

    const syncFromLocation = () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("route")) {
        setTarget(null);
        return;
      }

      setDateIso(currentDayDate());
      const frame = window.requestAnimationFrame(() => {
        setTarget(document.querySelector<HTMLElement>(".atlas-day-browse"));
      });
      return () => window.cancelAnimationFrame(frame);
    };

    const cancelFrame = syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener("atlas:day-change", syncFromLocation);

    return () => {
      cancelFrame?.();
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener("atlas:day-change", syncFromLocation);
    };
  }, []);

  if (!target) return null;

  const previousDate = shiftIsoDate(dateIso, -1);
  const nextDate = shiftIsoDate(dateIso, 1);

  function openDay(event: React.MouseEvent<HTMLAnchorElement>, targetDate: string) {
    event.preventDefault();
    const href = `/day?date=${encodeURIComponent(targetDate)}`;
    window.history.pushState({}, "", href);
    setDateIso(targetDate);
    window.dispatchEvent(new Event("atlas:day-change"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return createPortal(
    <nav className="atlas-day-adjacent-nav" aria-label="Browse adjacent days">
      <a
        href={`/day?date=${encodeURIComponent(previousDate)}`}
        aria-label="Open yesterday"
        onClick={(event) => openDay(event, previousDate)}
      >
        <span aria-hidden="true">←</span>
        <em>Yesterday</em>
      </a>
      <a
        href={`/day?date=${encodeURIComponent(nextDate)}`}
        aria-label="Open tomorrow"
        onClick={(event) => openDay(event, nextDate)}
      >
        <em>Tomorrow</em>
        <span aria-hidden="true">→</span>
      </a>
    </nav>,
    target,
  );
}
