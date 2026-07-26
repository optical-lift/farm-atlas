"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

function dayHref(dateIso: string) {
  return `/day?date=${encodeURIComponent(dateIso)}&view=work_order`;
}

export default function DayAdjacentNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const dateIso = searchParams.get("date") || localTodayIso();
  const route = searchParams.get("route");

  useEffect(() => {
    if (pathname !== "/day" || route) {
      setTarget(null);
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setTarget(document.querySelector<HTMLElement>(".atlas-day-browse"));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pathname, route]);

  if (!target) return null;

  const previousDate = shiftIsoDate(dateIso, -1);
  const nextDate = shiftIsoDate(dateIso, 1);

  function openDay(event: React.MouseEvent<HTMLAnchorElement>, targetDate: string) {
    event.preventDefault();
    router.push(`/day?date=${encodeURIComponent(targetDate)}&view=work_order`, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return createPortal(
    <nav className="atlas-day-adjacent-nav" aria-label="Browse adjacent days">
      <a
        href={dayHref(previousDate)}
        aria-label="Open yesterday"
        onClick={(event) => openDay(event, previousDate)}
      >
        <span aria-hidden="true">←</span>
        <em>Yesterday</em>
      </a>
      <a
        href={dayHref(nextDate)}
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
