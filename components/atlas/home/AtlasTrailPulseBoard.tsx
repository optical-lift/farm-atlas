"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  AtlasCard,
  AtlasSectionHeading,
  AtlasStateBadge,
} from "@/components/atlas/ui/AtlasPrimitives";

import styles from "./trail-pulse.module.css";

type AtlasTrailPulseState = "moving" | "blocked" | "waiting" | "review" | "missing_release";
type AtlasBadgeState = "moving" | "blocked" | "waiting" | "review" | "attention";

type AtlasTrailPulseItem = {
  trailId: string;
  subjectKind: string;
  subjectId: string;
  subjectLabel: string;
  scopeLabel: string;
  profileKey: string;
  profileLabel: string;
  currentNodeKey: string;
  currentNodeLabel: string;
  nextNodeKey?: string | null;
  nextNodeLabel?: string | null;
  state: AtlasTrailPulseState;
  taskId?: string | null;
  taskTitle?: string | null;
  taskStatus?: string | null;
  dueDate?: string | null;
  activeReleaseCount: number;
  pendingEvidenceCount: number;
  href: string;
};

type TrailPulseResponse = {
  ok: boolean;
  pulse?: AtlasTrailPulseItem[];
};

function badgeState(state: AtlasTrailPulseState): AtlasBadgeState {
  if (state === "missing_release") return "attention";
  return state;
}

function stateLabel(state: AtlasTrailPulseState) {
  if (state === "missing_release") return "Needs task";
  if (state === "blocked") return "Blocked";
  if (state === "waiting") return "Waiting";
  if (state === "review") return "Review";
  return "Moving";
}

function prettyDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function AtlasTrailPulseBoard() {
  const [items, setItems] = useState<AtlasTrailPulseItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/atlas/trail-pulse", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((result: TrailPulseResponse) => {
        if (!active) return;
        setItems(result.ok && Array.isArray(result.pulse) ? result.pulse : []);
        setLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setItems([]);
        setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => ({
    moving: items.filter((item) => item.state === "moving").length,
    blocked: items.filter((item) => item.state === "blocked").length,
    waiting: items.filter((item) => item.state === "waiting" || item.state === "review").length,
    missing: items.filter((item) => item.state === "missing_release").length,
  }), [items]);

  if (!loaded || items.length === 0) return null;

  return (
    <AtlasCard as="section" id="trail-pulse" className={styles.root} ariaLabelledBy="trail-pulse-title">
      <AtlasSectionHeading
        kicker="Release state"
        title="Trail Pulse"
        count={items.length}
        id="trail-pulse-title"
      />

      <div className={styles.summary} aria-label="Trail Pulse summary">
        <span><b>{counts.moving}</b>moving</span>
        <span><b>{counts.blocked}</b>blocked</span>
        <span><b>{counts.waiting}</b>waiting or review</span>
        <span><b>{counts.missing}</b>needs a task</span>
      </div>

      <div className={styles.list}>
        {items.map((item) => {
          const due = prettyDate(item.dueDate);
          const supportCount = Math.max(0, item.activeReleaseCount - 1);
          return (
            <Link
              key={item.trailId}
              href={item.href}
              className={styles.card}
              data-pulse-state={item.state}
            >
              <div className={styles.topline}>
                <span>{item.scopeLabel} · {item.profileLabel}</span>
                <AtlasStateBadge state={badgeState(item.state)}>{stateLabel(item.state)}</AtlasStateBadge>
              </div>
              <strong>{item.subjectLabel}</strong>
              <p className={styles.position}>
                <b>{item.currentNodeLabel}</b>
                {item.nextNodeLabel ? ` → ${item.nextNodeLabel}` : " → Complete"}
              </p>
              <p className={styles.move}>
                {item.taskTitle
                  ? `Current task · ${item.taskTitle}`
                  : `No task is released for ${item.currentNodeLabel}.`}
              </p>
              <div className={styles.meta}>
                {due ? <span>Due {due}</span> : null}
                {supportCount ? <span>{supportCount} supporting {supportCount === 1 ? "task" : "tasks"}</span> : null}
                {item.pendingEvidenceCount ? <span>{item.pendingEvidenceCount} evidence pending</span> : null}
              </div>
            </Link>
          );
        })}
      </div>
    </AtlasCard>
  );
}
