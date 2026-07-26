"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [target, setTarget] = useState<HTMLElement | null>(null);

  const dateIso = searchParams.get("date") || localTodayIso();
  const route = searchParams.get("route");
  const previousDate = useMemo(() => shiftIsoDate(dateIso, -1), [dateIso]);
  const nextDate = useMemo(() => shiftIsoDate(dateIso, 1), [dateIso]);

  useEffect(() => {
    if (pathname !== "/day" || route) {
      setTarget(null);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setTarget(document.querySelector<HTMLElement>(".atlas-day-browse"));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pathname, route, dateIso]);

  if (pathname !== "/day" || route || !target) return null;

  return createPortal(
    <nav className="atlas-day-adjacent-nav" aria-label="Browse adjacent days">
      <a href={`/day?date=${encodeURIComponent(previousDate)}`} aria-label="Open yesterday">
        <span aria-hidden="true">←</span>
        <em>Yesterday</em>
      </a>
      <a href={`/day?date=${encodeURIComponent(nextDate)}`} aria-label="Open tomorrow">
        <em>Tomorrow</em>
        <span aria-hidden="true">→</span>
      </a>
    </nav>,
    target,
  );
}
