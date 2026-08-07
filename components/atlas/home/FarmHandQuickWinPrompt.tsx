"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { AtlasUniversalHomeModel, AtlasUniversalMove } from "@/lib/atlas/universal-home";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

type Props = {
  home: AtlasUniversalHomeModel;
  active: boolean;
};

const QUICK_WIN_MAX_MINUTES = 10;
const MINUTE_KEYS = [
  "expected_minutes",
  "estimated_minutes",
  "duration_minutes",
  "active_minutes",
  "expected_active_minutes",
  "estimated_active_minutes",
  "minutes",
] as const;

function taskIdFromMove(move: AtlasUniversalMove) {
  if (move.kind !== "farm_task" || !move.key.startsWith("farm-task:")) return null;
  return move.key.split(":").at(-1) ?? null;
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function minuteEstimate(task: AtlasTaskCard) {
  for (const key of MINUTE_KEYS) {
    const value = numericValue(task.metadata?.[key]);
    if (value !== null && value > 0) return Math.round(value);
  }
  return null;
}

function quickWinForHome(home: AtlasUniversalHomeModel) {
  const taskById = new Map<string, AtlasTaskCard>();
  home.farms.forEach((farm) => farm.taskCards.forEach((task) => taskById.set(task.task_id, task)));

  for (const move of home.moves) {
    if (move.kind !== "farm_task" || move.state === "blocked") continue;
    const taskId = taskIdFromMove(move);
    if (!taskId) continue;
    const task = taskById.get(taskId);
    if (!task) continue;
    const minutes = minuteEstimate(task);
    if (minutes === null || minutes > QUICK_WIN_MAX_MINUTES) continue;

    const explicitQuickWin = task.metadata?.quick_win === true || task.metadata?.quick_win === "true";
    const activation = typeof task.metadata?.activation_demand === "string" ? task.metadata.activation_demand.toLowerCase() : "";
    const ambiguity = typeof task.metadata?.ambiguity_load === "string" ? task.metadata.ambiguity_load.toLowerCase() : "";
    const setup = typeof task.metadata?.setup_load === "string" ? task.metadata.setup_load.toLowerCase() : "";
    const clearlyLowFriction = ![activation, ambiguity, setup].some((value) => value === "high");
    if (!explicitQuickWin && !clearlyLowFriction) continue;

    return { move, taskId, minutes };
  }

  return null;
}

export default function FarmHandQuickWinPrompt({ home, active }: Props) {
  const quickWin = useMemo(() => active ? quickWinForHome(home) : null, [active, home]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!quickWin) {
      setOpen(false);
      return;
    }
    const key = `atlas:quick-win:dismissed:${home.window.doneDate}:${quickWin.taskId}`;
    setOpen(window.sessionStorage.getItem(key) !== "1");
  }, [home.window.doneDate, quickWin]);

  if (!quickWin || !open) return null;

  function dismiss() {
    const key = `atlas:quick-win:dismissed:${home.window.doneDate}:${quickWin.taskId}`;
    window.sessionStorage.setItem(key, "1");
    setOpen(false);
  }

  const minuteLabel = quickWin.minutes === 1 ? "1-minute" : `${quickWin.minutes}-minute`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="atlas-quick-win-title"
      data-atlas-quick-win="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "grid",
        placeItems: "center",
        padding: 22,
        background: "rgba(28, 25, 21, .38)",
        backdropFilter: "blur(3px)",
      }}
    >
      <section
        style={{
          position: "relative",
          width: "min(390px, 100%)",
          borderRadius: 20,
          padding: "28px 24px 24px",
          background: "#f8f4e9",
          boxShadow: "0 24px 70px rgba(24, 20, 17, .28)",
          color: "#27231f",
        }}
      >
        <button
          type="button"
          aria-label="Close quick task prompt"
          onClick={dismiss}
          style={{
            position: "absolute",
            top: 10,
            right: 12,
            width: 34,
            height: 34,
            border: 0,
            background: "transparent",
            fontSize: 22,
            lineHeight: 1,
            cursor: "pointer",
            opacity: .55,
          }}
        >
          ×
        </button>
        <small style={{ display: "block", marginBottom: 8, fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", opacity: .58 }}>
          One quick thing first
        </small>
        <h2 id="atlas-quick-win-title" style={{ margin: 0, fontSize: 25, lineHeight: 1.08 }}>
          {quickWin.move.title}
        </h2>
        <p style={{ margin: "14px 0 5px", fontSize: 17, lineHeight: 1.42 }}>
          This is a {minuteLabel} task. Let’s do it before we move forward with the day.
        </p>
        {quickWin.move.detail ? <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.4, opacity: .72 }}>{quickWin.move.detail}</p> : null}
        <Link
          href={quickWin.move.href}
          style={{
            display: "block",
            marginTop: 20,
            borderRadius: 12,
            padding: "13px 16px",
            background: "#4d3475",
            color: "white",
            textAlign: "center",
            textDecoration: "none",
            fontWeight: 800,
          }}
        >
          Do it now
        </Link>
      </section>
    </div>
  );
}
