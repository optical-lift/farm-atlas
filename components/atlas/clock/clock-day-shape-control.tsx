"use client";

import { useEffect, useMemo, useState } from "react";

import { atlasFarmDateLabel } from "@/lib/atlas/farm-day";
import type { AtlasWorkerDayShape } from "@/lib/atlas/worker-day-chronology";
import { commitAtlasWorkerDayShape } from "@/lib/atlas/worker-day-shape-client";
import styles from "./clock-surface-v2.module.css";

const weekdays = [
  { value: 1, label: "M" },
  { value: 2, label: "T" },
  { value: 3, label: "W" },
  { value: 4, label: "T" },
  { value: 5, label: "F" },
  { value: 6, label: "S" },
  { value: 0, label: "S" },
] as const;

function timeValue(value: string | null) {
  return value && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : "";
}

function timeLabel(value: string | null) {
  const normalized = timeValue(value);
  if (!normalized) return "—";
  const [hour, minute] = normalized.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function weekdayLabel(values: number[]) {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return values.map((value) => names[value]).join(", ");
}

export default function ClockDayShapeControl(props: {
  dateIso: string;
  canManage: boolean;
  dayShape: AtlasWorkerDayShape | null;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const { dayShape } = props;
  const [editing, setEditing] = useState(dayShape?.state !== "resolved");
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(dayShape?.weekdays ?? []);
  const [localStart, setLocalStart] = useState(timeValue(dayShape?.localStart ?? null));
  const [localEnd, setLocalEnd] = useState(timeValue(dayShape?.localEnd ?? null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEditing(dayShape?.state !== "resolved");
    setSelectedWeekdays(dayShape?.weekdays ?? []);
    setLocalStart(timeValue(dayShape?.localStart ?? null));
    setLocalEnd(timeValue(dayShape?.localEnd ?? null));
  }, [props.dateIso, dayShape?.policyId, dayShape?.policyVersion, dayShape?.state]);

  const valid = useMemo(() => selectedWeekdays.length > 0 && Boolean(localStart) && Boolean(localEnd) && localEnd > localStart, [selectedWeekdays, localStart, localEnd]);
  if (!props.canManage) return null;

  function toggleWeekday(value: number) {
    setSelectedWeekdays((current) => current.includes(value)
      ? current.filter((weekday) => weekday !== value)
      : [...current, value].sort((left, right) => left - right));
  }

  async function save() {
    if (!valid) return;
    setSaving(true);
    props.onError(null);
    try {
      await commitAtlasWorkerDayShape({
        serviceDate: props.dateIso,
        weekdays: selectedWeekdays,
        localStart,
        localEnd,
      });
      await props.onChanged();
      setEditing(false);
    } catch (error) {
      props.onError(error instanceof Error ? error.message : "Atlas could not update the Worker Day shape.");
    } finally {
      setSaving(false);
    }
  }

  const resolved = dayShape?.state === "resolved";
  return <section className={styles.taskShell} data-clock-day-shape-control="true">
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
      <div>
        <small style={{ display: "block", color: "#7b80a7", fontSize: 8, fontWeight: 950, letterSpacing: ".12em" }}>WORKER DAY SHAPE</small>
        <strong style={{ display: "block", marginTop: 3, fontSize: 12 }}>
          {resolved ? `${timeLabel(dayShape.localStart)}–${timeLabel(dayShape.localEnd)}` : dayShape?.state === "policy_conflict" ? "Day Shape conflict" : "Clock anchor required"}
        </strong>
        <span style={{ display: "block", marginTop: 3, color: "#777983", fontSize: 9, lineHeight: 1.35 }}>
          {resolved
            ? `${weekdayLabel(dayShape.weekdays)} · owner-authored execution boundary`
            : "Atlas will not invent Anna's start and finish time. Author the weekly worker boundary before asking it to arrange exact hours."}
        </span>
      </div>
      {resolved && !editing ? <button type="button" onClick={() => setEditing(true)} style={{ border: "1px solid rgba(88,87,111,.18)", borderRadius: 8, background: "#fff", padding: "6px 9px", fontSize: 9, fontWeight: 900 }}>Edit</button> : null}
    </div>

    {editing ? <div style={{ display: "grid", gap: 9, marginTop: 10, paddingTop: 9, borderTop: "1px solid rgba(107,108,118,.10)" }}>
      <div>
        <span style={{ display: "block", marginBottom: 5, color: "#777983", fontSize: 8, fontWeight: 900 }}>WEEKDAYS</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
          {weekdays.map((weekday, index) => {
            const selected = selectedWeekdays.includes(weekday.value);
            return <button
              type="button"
              aria-label={["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][index]}
              aria-pressed={selected}
              key={`${weekday.value}:${index}`}
              onClick={() => toggleWeekday(weekday.value)}
              style={{ minHeight: 34, border: "1px solid rgba(104,106,124,.20)", borderRadius: 8, background: selected ? "#dedff0" : "#fff", color: "#4e5271", fontSize: 10, fontWeight: 950 }}
            >{weekday.label}</button>;
          })}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label style={{ display: "grid", gap: 4, color: "#777983", fontSize: 8, fontWeight: 900 }}>START<input type="time" value={localStart} onChange={(event) => setLocalStart(event.target.value)} style={{ minHeight: 38, border: "1px solid rgba(104,106,124,.20)", borderRadius: 8, padding: "6px 8px", background: "#fff" }}/></label>
        <label style={{ display: "grid", gap: 4, color: "#777983", fontSize: 8, fontWeight: 900 }}>END<input type="time" value={localEnd} onChange={(event) => setLocalEnd(event.target.value)} style={{ minHeight: 38, border: "1px solid rgba(104,106,124,.20)", borderRadius: 8, padding: "6px 8px", background: "#fff" }}/></label>
      </div>
      <span style={{ color: "#7d7e89", fontSize: 8.5, lineHeight: 1.35 }}>
        Effective from {atlasFarmDateLabel(props.dateIso, { month: "short", day: "numeric", year: "numeric" })}. This authors recurring farm-execution time; it does not commit task placements.
        {dayShape?.expectedElapsedWorkdayMinutes ? ` Current capacity contract expects ${dayShape.expectedElapsedWorkdayMinutes} elapsed minutes.` : ""}
      </span>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        {resolved ? <button type="button" disabled={saving} onClick={() => setEditing(false)} style={{ border: "1px solid rgba(104,106,124,.18)", borderRadius: 8, background: "transparent", padding: "7px 10px", fontSize: 9, fontWeight: 900 }}>Cancel</button> : null}
        <button type="button" disabled={!valid || saving} onClick={() => void save()} style={{ border: 0, borderRadius: 8, background: "#555b88", color: "#fff", padding: "7px 11px", fontSize: 9, fontWeight: 950, opacity: !valid || saving ? .45 : 1 }}>{saving ? "Saving…" : "Save Day Shape"}</button>
      </div>
    </div> : null}
  </section>;
}
