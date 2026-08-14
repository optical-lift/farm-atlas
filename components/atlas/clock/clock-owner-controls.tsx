"use client";

import { useState } from "react";

import { useAtlasRuntimeActions } from "@/components/atlas/runtime/AtlasRuntimeProvider";
import type { AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";

type Item = Extract<AtlasDaySequenceItem, { kind: "committed_task" }>;

export default function ClockOwnerControls(props: {
  item: Item;
  dateIso: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
  showTime?: boolean;
  compact?: boolean;
}) {
  const { item } = props;
  const { dispatchClockCommand } = useAtlasRuntimeActions();
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("");
  const [saving, setSaving] = useState(false);
  if (!props.canManage || !item.taskId) return null;

  async function saveTime(localTime: string | null) {
    if (!item.taskId) return;
    setSaving(true);
    props.onError(null);
    try {
      await dispatchClockCommand({ kind: "clock_time", serviceDate: props.dateIso, taskId: item.taskId, localTime });
      setTime("");
      setDuration("");
    } catch (error) {
      props.onError(error instanceof Error ? error.message : "Clock update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDuration(durationMinutes: number | null) {
    if (!item.taskId) return;
    setSaving(true);
    props.onError(null);
    try {
      await dispatchClockCommand({ kind: "clock_duration", serviceDate: props.dateIso, taskId: item.taskId, durationMinutes });
      setTime("");
      setDuration("");
    } catch (error) {
      props.onError(error instanceof Error ? error.message : "Clock update failed.");
    } finally {
      setSaving(false);
    }
  }

  const durationValue = duration || (item.plannedDurationMinutes ? String(item.plannedDurationMinutes) : "");
  const parsedDuration = Number(durationValue);
  const durationValid = Number.isInteger(parsedDuration) && parsedDuration >= 5 && parsedDuration <= 720;
  const panel = <div data-clock-owner-controls="true" style={{ display: "grid", gap: 5 }}>
    {props.showTime !== false ? <div style={{ display: "flex", gap: 5 }}>
      <input aria-label={`Start time for ${item.title}`} type="time" value={time} onChange={(event) => setTime(event.target.value)} />
      <button type="button" disabled={!time || saving} onClick={() => void saveTime(time)}>{item.plannedStartAt ? "Save time" : "Place"}</button>
      {item.plannedStartAt ? <button type="button" disabled={saving} onClick={() => void saveTime(null)}>Remove time</button> : null}
    </div> : null}
    {item.plannedStartAt ? <div data-clock-owner-duration-controls="true" style={{ display: "flex", gap: 5, alignItems: "center" }}>
      <input aria-label={`Planned duration for ${item.title}`} type="number" min="5" max="720" step="5" value={durationValue} placeholder="minutes" onChange={(event) => setDuration(event.target.value)} />
      <button type="button" disabled={!durationValid || saving} onClick={() => void saveDuration(parsedDuration)}>Save span</button>
      {!item.plannedDurationMinutes && item.estimatedMinutes ? <button type="button" disabled={saving} onClick={() => void saveDuration(item.estimatedMinutes)}>Use estimate</button> : null}
      {item.plannedDurationMinutes ? <button type="button" disabled={saving} onClick={() => void saveDuration(null)}>Remove span</button> : null}
    </div> : null}
  </div>;

  if (!props.compact) return <div style={{ marginTop: 6 }}>{panel}</div>;
  return <details style={{ position: "absolute", top: 4, right: 4, zIndex: 20 }}>
    <summary style={{ cursor: "pointer", listStyle: "none", padding: "2px 5px", borderRadius: 6, background: "rgba(247,246,250,.96)", fontSize: 8, fontWeight: 900 }}>Edit</summary>
    <div style={{ position: "absolute", top: 22, right: 0, width: 285, padding: 8, border: "1px solid rgba(104,106,124,.2)", borderRadius: 9, background: "#fff", boxShadow: "0 5px 18px rgba(55,51,74,.14)" }}>{panel}</div>
  </details>;
}
