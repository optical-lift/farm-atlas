"use client";

import { useMemo, useState } from "react";

import { useAtlasRuntimeActions } from "@/components/atlas/runtime/AtlasRuntimeProvider";
import {
  atlasDayReservationSourceLabel,
  type AtlasDayReservation,
  type AtlasDayReservationKind,
} from "@/lib/atlas/day-reservations";

const FARM_TIME_ZONE = "America/Chicago";

function minuteToTime(value: number) {
  const minute = Math.max(0, Math.min(1439, Math.round(value / 5) * 5));
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function localTime(instant: string | null | undefined) {
  if (!instant) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: FARM_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}`;
}

export default function ReservationEditor({
  dateIso,
  reservation,
  defaultStartMinute = 12 * 60,
  onClose,
}: {
  dateIso: string;
  reservation?: AtlasDayReservation | null;
  defaultStartMinute?: number;
  onClose: () => void;
}) {
  const { dispatchReservationCommand } = useAtlasRuntimeActions();
  const reservationId = useMemo(() => reservation?.reservationId ?? crypto.randomUUID(), [reservation?.reservationId]);
  const [kind, setKind] = useState<AtlasDayReservationKind>(reservation?.kind ?? "external_commitment");
  const [title, setTitle] = useState(reservation?.title ?? "");
  const [startTime, setStartTime] = useState(localTime(reservation?.startAt) || minuteToTime(defaultStartMinute));
  const [endTime, setEndTime] = useState(localTime(reservation?.endAt) || minuteToTime(defaultStartMinute + 30));
  const [note, setNote] = useState(reservation?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) { setError("Give this fixed time a label."); return; }
    if (!startTime || !endTime || endTime <= startTime) { setError("End time must be after start time on this day."); return; }
    setSaving(true); setError(null);
    try {
      if (reservation) {
        await dispatchReservationCommand({
          kind: "reservation_change",
          serviceDate: dateIso,
          reservationId,
          reservationKind: kind,
          title: title.trim(),
          startLocalTime: startTime,
          endLocalTime: endTime,
          note: note.trim() || null,
        });
      } else {
        await dispatchReservationCommand({
          kind: "reservation_create",
          serviceDate: dateIso,
          reservationId,
          reservationKind: kind,
          title: title.trim(),
          startLocalTime: startTime,
          endLocalTime: endTime,
          note: note.trim() || null,
        });
      }
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Atlas could not save this fixed time.");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!reservation) return;
    setSaving(true); setError(null);
    try {
      await dispatchReservationCommand({ kind: "reservation_remove", serviceDate: dateIso, reservationId });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Atlas could not remove this fixed time.");
    } finally { setSaving(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={reservation ? `Edit ${reservation.title}` : "Add fixed time"} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(18,20,27,.42)", display: "grid", alignItems: "end" }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section style={{ background: "#fff", borderRadius: "18px 18px 0 0", padding: "18px", boxShadow: "0 -12px 40px rgba(0,0,0,.18)", maxWidth: 520, width: "100%", margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
          <div><small style={{ display: "block", textTransform: "uppercase", letterSpacing: ".08em", color: "#777" }}>{reservation ? "Fixed time" : "Add fixed time"}</small><strong style={{ fontSize: 18 }}>Reservation, not task</strong>{reservation ? <span style={{ display: "block", fontSize: 11, color: "#777", marginTop: 3 }}>{atlasDayReservationSourceLabel(reservation.source)}{reservation.source !== "owner_manual" ? " · editing this occurrence only" : ""}</span> : null}</div>
          <button type="button" onClick={onClose} aria-label="Close reservation editor" style={{ border: 0, background: "transparent", fontSize: 22 }}>×</button>
        </header>
        <label style={{ display: "grid", gap: 5, marginBottom: 10 }}><span style={{ fontSize: 11, fontWeight: 800 }}>Label</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Walmart Pickup" style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9 }} /></label>
        <label style={{ display: "grid", gap: 5, marginBottom: 10 }}><span style={{ fontSize: 11, fontWeight: 800 }}>Type</span><select value={kind} onChange={(event) => setKind(event.target.value as AtlasDayReservationKind)} style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9 }}><option value="external_commitment">External commitment</option><option value="meal">Meal</option><option value="routine">Routine</option></select></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <label style={{ display: "grid", gap: 5 }}><span style={{ fontSize: 11, fontWeight: 800 }}>Start</span><input type="time" step="300" value={startTime} onChange={(event) => setStartTime(event.target.value)} style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9 }} /></label>
          <label style={{ display: "grid", gap: 5 }}><span style={{ fontSize: 11, fontWeight: 800 }}>End</span><input type="time" step="300" value={endTime} onChange={(event) => setEndTime(event.target.value)} style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9 }} /></label>
        </div>
        <label style={{ display: "grid", gap: 5, marginBottom: 12 }}><span style={{ fontSize: 11, fontWeight: 800 }}>Operational note <i style={{ fontWeight: 400 }}>optional</i></span><input value={note} onChange={(event) => setNote(event.target.value)} style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9 }} /></label>
        {error ? <p style={{ color: "#9c3434", fontSize: 12, margin: "0 0 10px" }}>{error}</p> : null}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => void save()} disabled={saving} style={{ flex: 1, border: 0, borderRadius: 10, padding: 11, background: "#262833", color: "white", fontWeight: 800 }}>{saving ? "Saving…" : "Save fixed time"}</button>
          {reservation ? <button type="button" onClick={() => void remove()} disabled={saving} style={{ border: "1px solid #e0c9c9", borderRadius: 10, padding: "11px 13px", background: "#fff", color: "#8b3d3d", fontWeight: 800 }}>Remove</button> : null}
        </div>
      </section>
    </div>
  );
}
