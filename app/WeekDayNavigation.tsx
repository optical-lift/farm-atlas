"use client";

import { useEffect } from "react";

function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function openHomeDayCard(target: HTMLElement) {
  const card = target.closest(".atlas-week-day-preview-card");
  if (!card) return false;
  const cards = Array.from(document.querySelectorAll(".atlas-week-day-preview-card"));
  const index = Math.max(0, cards.indexOf(card));
  window.location.assign(`/day?date=${encodeURIComponent(addDaysIso(index + 1))}`);
  return true;
}

export default function WeekDayNavigation() {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (openHomeDayCard(target)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return null;
}
