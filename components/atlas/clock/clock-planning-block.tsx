"use client";

import Link from "next/link";
import { useRef } from "react";

import type { AtlasClockDraftBlock, AtlasClockDraftDecision } from "@/lib/atlas/clock-plan-draft";
import { atlasTimingClassLabel } from "@/lib/atlas/timing-mobility";

import styles from "./clock-surface-v2.module.css";

const HOUR_HEIGHT = 64;
const STEP_MINUTES = 5;

type DragState = {
  pointerId: number;
  mode: "move" | "resize";
  originY: number;
  startMinute: number;
  durationMinutes: number;
};

function minuteLabel(value: number) {
  const minute = ((Math.round(value) % 1440) + 1440) % 1440;
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function taskHref(taskId: string, dateIso: string) {
  const returnTo = `/clock?date=${encodeURIComponent(dateIso)}`;
  return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(returnTo)}`;
}

function snappedDelta(pixelDelta: number) {
  const rawMinutes = (pixelDelta / HOUR_HEIGHT) * 60;
  return Math.round(rawMinutes / STEP_MINUTES) * STEP_MINUTES;
}

export default function ClockPlanningBlock(props: {
  block: AtlasClockDraftBlock;
  dateIso: string;
  top: number;
  height: number;
  onMove: (id: string, startMinute: number) => void;
  onResize: (id: string, durationMinutes: number) => void;
  onDecision: (id: string, decision: AtlasClockDraftDecision) => void;
  onOverride: (id: string, value: boolean) => void;
  onUnplace: (id: string) => void;
}) {
  const { block } = props;
  const dragRef = useRef<DragState | null>(null);
  if (block.startMinute === null || block.decision === "reject") return null;
  const purple = block.source === "proposal";
  const accepted = block.decision === "accept";
  const hasWarnings = block.warnings.length > 0;

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>, mode: DragState["mode"]) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      originY: event.clientY,
      startMinute: block.startMinute as number,
      durationMinutes: block.durationMinutes,
    };
  }

  function continueDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const delta = snappedDelta(event.clientY - drag.originY);
    if (drag.mode === "move") {
      const next = Math.max(0, Math.min(24 * 60 - block.durationMinutes, drag.startMinute + delta));
      props.onMove(block.id, next);
    } else {
      const next = Math.max(5, Math.min(720, drag.durationMinutes + delta));
      props.onResize(block.id, next);
    }
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  const durationSource = block.durationSource === "estimate"
    ? "estimate"
    : block.durationSource === "planning_default"
      ? "planning hold"
      : "planned span";

  return <div
    className={`${styles.timedTask} ${styles.planningBlock}`}
    style={{ top: props.top, height: props.height, left: "61px", width: "calc(100% - 69px)", overflow: "visible" }}
    data-clock-plan-block="true"
    data-clock-plan-source={block.source}
    data-clock-plan-decision={block.decision}
    data-clock-readiness-independent="true"
    data-timing-class={purple ? "potential" : block.item.mobility.timingClass}
    data-warning={hasWarnings ? "true" : "false"}
  >
    <Link className={styles.planningBlockLink} href={block.taskId ? taskHref(block.taskId, props.dateIso) : `/clock?date=${props.dateIso}`}>
      <small>{purple ? "Atlas proposes" : "Committed draft"} · {minuteLabel(block.startMinute)}–{minuteLabel(block.startMinute + block.durationMinutes)}</small>
      <span className={styles.mobility}>{purple ? "Potential" : atlasTimingClassLabel(block.item.mobility)}</span>
      <strong>{block.item.title}</strong>
      <span>{block.durationMinutes}m {durationSource}{block.proposalReason ? ` · ${block.proposalReason}` : ""}</span>
    </Link>

    <button
      type="button"
      className={styles.dragHandle}
      aria-label={`Drag ${block.item.title} earlier or later`}
      title="Drag earlier or later"
      onPointerDown={(event) => beginDrag(event, "move")}
      onPointerMove={continueDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >↗</button>
    <button
      type="button"
      className={styles.resizeHandle}
      aria-label={`Resize duration for ${block.item.title}}
      title="Drag to resize duration"
      onPointerDown={(event) => beginDrag(event, "resize")}
      onPointerMove={continueDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >⋮</button>

    <details className={styles.planDetails}>
      <summary>Plan</summary>
      <div className={styles.planPopover}>
        <div className={styles.planButtons}>
          <button type="button" onClick={() => props.onMove(block.id, Math.max(0, block.startMinute as number - 15))}>∏15m</button>
          <button type="button" onClick={() => props.onMove(block.id, Math.min(24 * 60 - block.durationMinutes, (block.startMinute as number) + 15))}>+15m</button>
          <button type="button" onClick={() => props.onResize(block.id, Math.max(5, block.durationMinutes - 15))}>Shorter</button>
          <button type="button" onClick={() => props.onResize(block.id, Math.min(720, block.durationMinutes + 15))}>Longer</button>
        </div>
        {purple ? <div className={styles.planButtons}>
          {accepted
            ? <button type="button" onClick={() => props.onDecision(block.id, "pending")}>Undo use</button>
            : <button type="button" className={styles.planPrimary} onClick={() => props.onDecision(block.id, "accept")}>Use this</button>}
          <button type="button" onClick={() => props.onDecision(block.id, "reject")}>Not this</button>
        </div> : <button type="button" className={styles.planUnplace} onClick={() => props.onUnplace(block.id)}>Return to Unplaced</button>}
        {hasWarnings ? <div className={styles.planWarning} data-clock-plan-warning="true">
          <strong>Timing warning</strong>
          <ul>{block.warnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}</ul>
          <button type="button" className={block.overrideWarnings ? styles.planOverrideActive : ""} onClick={() => props.onOverride(block.id, !block.overrideWarnings)}>{block.overrideWarnings ? "Override recorded" : "Override warning"}</button>
        </div> : null}
        {purple ? <small className={styles.planState}>{accepted ? "Will become white only when the plan is committed." : "Still only a proposal."}</small> : <small className={styles.planState}>White task truth is unchanged until Commit plan.</small>}
      </div>
    </details>
  </div>;
}
