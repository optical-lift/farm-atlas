"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { atlasFarmDateIso, atlasShiftFarmDate } from "@/lib/atlas/farm-day";

function liveDateIso() {
  const params = new URLSearchParams(window.location.search);
  return params.get("date") || atlasFarmDateIso();
}

function dayHref(dateIso: string) {
  return `/day?date=${encodeURIComponent(dateIso)}&view=work_order`;
}

export default function DayAdjacentNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const dateIso = searchParams.get("date") || atlasFarmDateIso();
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

  const previousDate = atlasShiftFarmDate(dateIso, -1);
  const nextDate = atlasShiftFarmDate(dateIso, 1);

  function openDay(event: React.MouseEvent<HTMLAnchorElement>, offsetDays: number) {
    event.preventDefault();
    const targetDate = atlasShiftFarmDate(liveDateIso(), offsetDays);
    router.push(`/day?date=${encodeURIComponent(targetDate)}&view=work_order`, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return createPortal(
    <nav className="atlas-day-adjacent-nav" aria-label="Browse adjacent days">
      <a
        href={dayHref(previousDate)}
        aria-label="Open yesterday"
        onClick={(event) => openDay(event, -1)}
      >
        <span aria-hidden="true">←</span>
        <em>Yesterday</em>
      </a>
      <a
        href={dayHref(nextDate)}
        aria-label="Open tomorrow"
        onClick={(event) => openDay(event, 1)}
      >
        <em>Tomorrow</em>
        <span aria-hidden="true">→</span>
      </a>
    </nav>,
    target,
  );
}
