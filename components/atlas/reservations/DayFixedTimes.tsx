"use client";

import { useState } from "react";

import { useAtlasWorkerDayProjection } from "@/components/atlas/runtime/AtlasRuntimeProvider";
import ReservationEditor from "@/components/atlas/reservations/ReservationEditor";
import type { AtlasDayReservation } from "@/lib/atlas/day-reservations";

const FARM_TIME_ZONE = "America/Chicago";
type EditorState = AtlasDayReservation | "new" | null;

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FARM_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function kindLabel(reservation: AtlasDayReservation) {
  if (reservation.kind === "meal") return "Meal";
  if (reservation.kind === "routine") return "Routine";
  return "Commitment";
}

export default function DayFixedTimes({ dateIso }: { dateIso: string }) {
  const { projection, canManage, loading } = useAtlasWorkerDayProjection(dateIso);
  const [editing, setEditing] = useState<EditorState>(null);
  const reservations = projection?.reservations ?? [];
  if (loading && !projection) return null;

  const editor = editing ? (
    <ReservationEditor
      dateIso={dateIso}
      reservation={editing === "new" ? null : editing}
      onClose={() => setEditing(null)}
    />
  ) : null;

  if (!reservations.length) return canManage ? (
    <section data-day-fixed-times="true" style={{ margin: "0 0 12px", padding: "10px 12px", border: "1px solid rgba(88,87,111,.1)", borderRadius: 12, background: "rgba(248,248,251,.72)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}><div><small style={{ display: "block", color: "#777", textTransform: "uppercase", letterSpacing: ".08em", fontSize: 8 }}>Today’s fixed times</small><strong style={{ fontSize: 12 }}>No occupied life time recorded</strong></div><button type="button" onClick={() => setEditing("new")} style={{ border: "1px solid rgba(88,87,111,.14)", borderRadius: 999, background: "white", padding: "7px 10px", minHeight: 36, fontSize: 9, fontWeight: 800 }}>+ Add</button></div>
      {editor}
    </section>
  ) : null;

  return (
    <section data-day-fixed-times="true" aria-label="Today’s fixed times" style={{ margin: "0 0 12px", padding: "10px 12px", border: "1px solid rgba(88,87,111,.1)", borderRadius: 12, background: "rgba(248,248,251,.72)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 7 }}><div><small style={{ display: "block", color: "#777", textTransform: "uppercase", letterSpacing: ".08em", fontSize: 8 }}>Today’s fixed times</small><strong style={{ fontSize: 12 }}>Real time outside the task list</strong></div>{canManage ? <button type="button" onClick={() => setEditing("new")} style={{ border: "1px solid rgba(88,87,111,.14)", borderRadius: 999, background: "white", padding: "7px 10px", minHeight: 36, fontSize: 9, fontWeight: 800 }}>+ Add</button> : null}</header>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
        {reservations.map((reservation) => {
          const content = <><strong style={{ fontSize: 10, whiteSpace: "nowrap" }}>{timeLabel(reservation.startAt)}–{timeLabel(reservation.endAt)}</strong><span style={{ fontSize: 10, whiteSpace: "nowrap" }}>{reservation.title}</span><em style={{ fontSize: 8, fontStyle: "normal", color: "#777", whiteSpace: "nowrap" }}>{kindLabel(reservation)}</em></>;
          return canManage ? <button type="button" key={reservation.reservationId} onClick={() => setEditing(reservation)} data-day-fixed-time-reservation={reservation.reservationId} style={{ display: "grid", gap: 1, textAlign: "left", border: "1px solid rgba(88,87,111,.12)", borderRadius: 9, background: "#fff", padding: "8px 10px", minHeight: 44, color: "inherit" }}>{content}</button> : <div key={reservation.reservationId} data-day-fixed-time-reservation={reservation.reservationId} data-day-fixed-time-informational="true" style={{ display: "grid", gap: 1, border: "1px solid rgba(88,87,111,.12)", borderRadius: 9, background: "#fff", padding: "8px 10px", minHeight: 44 }}>{content}</div>;
        })}
      </div>
      {editor}
    </section>
  );
}
