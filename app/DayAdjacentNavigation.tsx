"use client";

import Link from "next/link";
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

export default function DayAdjacentNavigation() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [dateIso, setDateIso] = useState(localTodayIso());

  useEffect(() => {
    if (window.location.pathname !== "/day") return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("route")) return;

    setDateIso(params.get("date") || localTodayIso());
    const frame = window.requestAnimationFrame(() => {
      setTarget(document.querySelector<HTMLElement>(".atlas-day-browse"));
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (!target) return null;

  const previousDate = shiftIsoDate(dateIso, -1);
  const nextDate = shiftIsoDate(dateIso, 1);

  return createPortal(
    <nav className="atlas-day-adjacent-nav" aria-label="Browse adjacent days">
      <Link
        href={`/day?date=${encodeURIComponent(previousDate)}`}
        prefetch
        aria-label="Open yesterday"
        onClick={() => setDateIso(previousDate)}
      >
        <span aria-hidden="true">←</span>
        <em>Yesterday</em>
      </Link>
      <Link
        href={`/day?date=${encodeURIComponent(nextDate)}`}
        prefetch
        aria-label="Open tomorrow"
        onClick={() => setDateIso(nextDate)}
      >
        <em>Tomorrow</em>
        <span aria-hidden="true">→</span>
      </Link>
    </nav>,
    target,
  );
}
