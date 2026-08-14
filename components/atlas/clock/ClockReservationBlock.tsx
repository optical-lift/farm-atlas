"use client";

import { useRef, useState } from "react";

import { useAtlasRuntimeActions } from "@/components/atlas/runtime/AtlasRuntimeProvider";
import ReservationEditor from "@/components/atlas/reservations/ReservationEditor";
import type { AtlasClockReservation } from "@/lib/atlas/clock-reservations";
import { atlasDayReservationSourceLabel } from "@/lib/atlas/day-reservations";

import styles from "./clock-surface-v2.module.css";

const HOUR_HEIGHT = 64;
const SNAP_MINUTES = 5;

function minuteLabel(value: number) {
  const minute = ((Math.round(value) % 1440) + 1440) % 1440;
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function localTime(value: number) {
  const minute = Math.max(0, Math.min(1439, Math.round(value / SNAP_MINUTES) * SNAP_MINUTES));
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function typeLabel(source: AtlasClockReservation["source"]) {
  if (source === "routine") return "Routine";
  if (source === "meal") return "Meal";
  return "Commitment";
}

export default function ClockReservationBlock({
  dateIso,
  canManage,
  reservation,
  startHour,
}: {
  dateIso: string;
  canManage: boolean;
  reservation: AtlasClockReservation;
  startHour: number;
}) {
  const { dispatchReservationCommand } = useAtlasRuntimeActions();
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draggedRef = useRef(false);
  const entity = reservation.reservation;
  const startMinute = draft?.start ?? reservation.startMinute;
  const endMinute = draft?.end ?? reservation.endMinute;
  const top = ((startMinute - startHour * 60) / 60) * HOUR_HEIGHT;
  const height = Math.max(38, ((endMinute - startMinute) / 60) * HOUR_HEIGHT - 2);

  function beginDrag(event: React.PointerEvent, mode: "move" | "resize") {
    if (!canManage || !entity) return;
    event.preventDefault();
    event.stopPropagation();
    const originY = event.clientY;
    const originStart = reservation.startMinute;
    const originEnd = reservation.endMinute;
    const duration = originEnd - originStart;
    draggedRef.current = false;

    function onMove(moveEvent: PointerEvent) {
      const rawDelta = ((moveEvent.clientY - originY) / HOUR_HEIGHT) * 60;
      const delta = Math.round(rawDelta / SNAP_MINUTES) * SNAP_MINUTES;
      if (Math.abs(delta) >= SNAP_MINUTES) draggedRef.current = true;
      if (mode === "move") {
        const nextStart = Math.max(0, Math.min(1440 - duration, originStart + delta));
        setDraft({ start: nextStart, end: nextStart + duration });
      } else {
        const nextEnd = Math.max(originStart + SNAP_MINUTES, Math.min(1440, originEnd + delta));
        setDraft({ start: originStart, end: nextEnd });
      }
    }

    async function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const latest = draftRef.current;
      if (!latest || !draggedRef.current) { setDraft(null); return; }
      setError(null);
      try {
        if (mode === "move") {
          await dispatchReservationCommand({
            kind: "reservation_move",
            serviceDate: dateIso,
            reservationId: entity.reservationId,
            startLocalTime: localTime(latest.start),
          });
        } else {
          await dispatchReservationCommand({
            kind: "reservation_resize",
            serviceDate: dateIso,
            reservationId: entity.reservationId,
            endLocalTime: localTime(latest.end),
          });
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Atlas could not update this fixed time.");
      } finally {
        setDraft(null);
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  const draftRef = useRef(draft);
  draftRef.current = draft;

  return (
    <>
      <div
        className={styles.timedTask}
        style={{
          top,
          height,
          left: "61px",
          width: "calc(100% - 69px)",
          overflow: "hidden",
          background: "rgba(246,243,237,.96)",
          borderColor: "rgba(121,111,92,.35)",
          borderLeft: "3px solid rgba(121,111,92,.45)",
          zIndex: 4,
          cursor: canManage ? "grab" : "default",
          touchAction: "none",
        }}
        data-clock-day-reservation={reservation.kind}
        data-clock-reservation-source={reservation.source}
        data-clock-reservation-id={entity?.reservationId}
        data-clock-non-task="true"
        onPointerDown={(event) => beginDrag(event, "move")}
        onClick={(event) => {
          if (!canManage || !entity || draggedRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          setEditorOpen(true);
        }}
        title={error ?? reservation.reason}
      >
        <small>{minuteLabel(startMinute)}–{minuteLabel(endMinute)} · {typeLabel(reservation.source)}</small>
        <strong>{reservation.title}</strong>
        {entity ? <span style={{ fontSize: 9, opacity: .62 }}>{atlasDayReservationSourceLabel(entity.source)}</span> : null}
        {canManage && entity ? (
          <button
            type="button"
            aria-label={`Resize ${reservation.title}`}
            title="Drag to resize"
            onPointerDown={(event) => beginDrag(event, "resize")}
            onClick={(event) => event.stopPropagation()}
            style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 9, cursor: "ns-resize", border: 0, background: "transparent", padding: 0 }}
          />
        ) : null}
      </div>
      {editorOpen && entity ? <ReservationEditor dateIso={dateIso} reservation={entity} onClose={() => setEditorOpen(false)} /> : null}
    </>
  );
}
