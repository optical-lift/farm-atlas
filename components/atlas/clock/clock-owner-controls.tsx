"use client";

import { useState } from "react";

import type { AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";

type Item = Extract<AtlasDaySequenceItem, { kind: "committed_task" }>;

export default function ClockOwnerControls(props: {
  item: Item;
  dateIso: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
  showTime?: boolean;
}) {
  const { item } = props;
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("");
  const [saving, setSaving] = useState(false);
  if (!props.canManage || !item.taskId) return null;

  async function post(path: string, intent: string, body: Record<string, unknown>) {
    setSaving(true);
    props.onError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json", "x-atlas-intent": intent },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Clock update failed.");
      setTime("");
      setDuration("");
      await props.onChanged();
    } catch (error) {
      props.onError(error instanceof Error ? error.message : "Clock update failed.");
    } finally {
      setSaving(false);
    }
  }

  const durationValue = duration || (item.plannedDurationMinutes ? String(item.plannedDurationMinutes) : "");
  const parsedDuration = Number(durationValue);
  const durationValid = Number.isInteger(parsedDuration) && parsedDuration >= 5 && parsedDuration <= 720;

  return (
    <div data-clock-owner-controls="true" style={{ display: "grid", gap: 5, marginTop: 6 }}>
      {props.showTime !== false ? <div style={{ display: "flex", gap: 5 }}>
        <input aria-label={`Start time for ${item.title}`} type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        <button type="button" disabled={!time || saving} onClick={() => void post("/api/atlas/owner-day-task-time", "owner-clock-time-v1", { date: props.dateIso, taskId: item.taskId, localTime: time })}>{item.plannedStartAt ? "Save time" : "Place"}</button>
        {item.plannedStartAt ? <button type="button" disabled={saving} onClick={() => void post("/api/atlas/owner-day-task-time", "owner-clock-time-v1", { date: props.dateIso, taskId: item.taskId, localTime: null })}>Remove time</button> : null}
      </div> : null}
      {item.plannedStartAt ? <div data-clock-owner-duration-controls="true" style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <input aria-label={`Planned duration for ${item.title}`} type="number" min="5" max="720" step="5" value={durationValue} placeholder="minutes" onChange={(event) => setDuration(event.target.value)} />
        <button type="button" disabled={!durationValid || saving} onClick={() => void post("/api/atlas/owner-day-task-duration", "owner-clock-duration-v1", { date: props.dateIso, taskId: item.taskId, durationMinutes: parsedDuration })}>Save span</button>
        {!item.plannedDurationMinutes && item.estimatedMinutes ? <button type="button" disabled={saving} onClick={() => void post("/api/atlas/owner-day-task-duration", "owner-clock-duration-v1", { date: props.dateIso, taskId: item.taskId, durationMinutes: item.estimatedMinutes })}>Use estimate</button> : null}
        {item.plannedDurationMinutes ? <button type="button" disabled={saving} onClick={() => void post("/api/atlas/owner-day-task-duration", "owner-clock-duration-v1", { date: props.dateIso, taskId: item.taskId, durationMinutes: null })}>Remove span</button> : null}
      </div> : null}
    </div>
  );
}
