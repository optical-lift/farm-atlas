"use client";

import { useEffect, useMemo, useState } from "react";

import {
  commitAtlasFixedRoutineCommand,
  readAtlasFixedRoutines,
  type AtlasFixedRoutine,
} from "@/lib/atlas/fixed-routine-client";
import type { AtlasDayReservationKind } from "@/lib/atlas/day-reservations";

const WEEKDAYS = [
  { value: 0, short: "Sun", long: "Sunday" },
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
];

function timeToMinute(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minuteToTime(value: number) {
  const minute = Math.max(0, Math.min(1439, Math.round(value / 5) * 5));
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function endTime(routine: AtlasFixedRoutine) {
  const start = timeToMinute(routine.startLocalTime) ?? 0;
  return minuteToTime(Math.min(1439, start + routine.durationMinutes));
}

function timeLabel(value: string) {
  const minute = timeToMinute(value);
  if (minute === null) return value;
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function routineTimeLabel(routine: AtlasFixedRoutine) {
  return `${timeLabel(routine.startLocalTime)}–${timeLabel(endTime(routine))}`;
}

function weekdaySummary(values: number[]) {
  const normalized = [...new Set(values)].sort((a, b) => a - b);
  if (normalized.length === 7) return "Every day";
  if (normalized.join(",") === "1,2,3,4,5") return "Weekdays";
  if (normalized.join(",") === "0,6") return "Weekends";
  return normalized.map((value) => WEEKDAYS.find((day) => day.value === value)?.short ?? String(value)).join(" · ");
}

function typeLabel(kind: AtlasDayReservationKind) {
  if (kind === "meal") return "Meal";
  if (kind === "routine") return "Routine";
  return "External commitment";
}

function prettyDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function defaultWeekday(dateIso: string) {
  const date = new Date(`${dateIso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 1 : date.getDay();
}

function RoutineForm({
  routine,
  dateIso,
  onSaved,
  onBack,
}: {
  routine: AtlasFixedRoutine | null;
  dateIso: string;
  onSaved: () => Promise<void>;
  onBack: () => void;
}) {
  const routineId = useMemo(() => routine?.routineId ?? crypto.randomUUID(), [routine?.routineId]);
  const [kind, setKind] = useState<AtlasDayReservationKind>(routine?.kind ?? "routine");
  const [title, setTitle] = useState(routine?.title ?? "");
  const [startTime, setStartTime] = useState(routine?.startLocalTime ?? "12:30");
  const [end, setEnd] = useState(routine ? endTime(routine) : "13:00");
  const [weekdays, setWeekdays] = useState<number[]>(routine?.weekdays ?? [defaultWeekday(dateIso)]);
  const [effectiveFrom, setEffectiveFrom] = useState(routine?.effectiveFrom ?? dateIso);
  const [effectiveThrough, setEffectiveThrough] = useState(routine?.effectiveThrough ?? "");
  const [note, setNote] = useState(routine?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ended = Boolean(routine?.effectiveThrough && routine.effectiveThrough < dateIso);

  function toggleWeekday(value: number) {
    setWeekdays((current) => current.includes(value)
      ? current.filter((day) => day !== value)
      : [...current, value].sort((a, b) => a - b));
  }

  async function save() {
    if (!title.trim()) { setError("Give this repeating fixed time a label."); return; }
    if (!weekdays.length) { setError("Choose at least one day of the week."); return; }
    const startMinute = timeToMinute(startTime);
    const endMinute = timeToMinute(end);
    if (startMinute === null || endMinute === null || endMinute <= startMinute) {
      setError("End time must be after start time on the same day.");
      return;
    }
    if (!effectiveFrom) { setError("Choose when this routine begins."); return; }
    if (effectiveThrough && effectiveThrough < effectiveFrom) {
      setError("The final date cannot be before the routine begins.");
      return;
    }

    setSaving(true); setError(null);
    try {
      if (routine) {
        await commitAtlasFixedRoutineCommand({
          kind: "fixed_routine_change",
          routineId,
          reservationKind: kind,
          title: title.trim(),
          startLocalTime: startTime,
          endLocalTime: end,
          weekdays,
          effectiveFrom,
          effectiveThrough: effectiveThrough || null,
          note: note.trim() || null,
        });
      } else {
        await commitAtlasFixedRoutineCommand({
          kind: "fixed_routine_create",
          routineId,
          reservationKind: kind,
          title: title.trim(),
          startLocalTime: startTime,
          endLocalTime: end,
          weekdays,
          effectiveFrom,
          effectiveThrough: effectiveThrough || null,
          note: note.trim() || null,
        });
      }
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Atlas could not save this repeating fixed time.");
    } finally { setSaving(false); }
  }

  async function endAfterToday() {
    if (!routine) return;
    setSaving(true); setError(null);
    try {
      await commitAtlasFixedRoutineCommand({ kind: "fixed_routine_end", routineId, effectiveThrough: dateIso });
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Atlas could not end this routine.");
    } finally { setSaving(false); }
  }

  async function resume() {
    if (!routine) return;
    setSaving(true); setError(null);
    try {
      await commitAtlasFixedRoutineCommand({ kind: "fixed_routine_resume", routineId });
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Atlas could not resume this routine.");
    } finally { setSaving(false); }
  }

  return (
    <div data-fixed-routine-form="true">
      <button type="button" onClick={onBack} style={{ border: 0, background: "transparent", padding: "4px 0 12px", fontSize: 11, fontWeight: 800 }}>← Repeating fixed times</button>
      <div style={{ marginBottom: 14 }}>
        <small style={{ display: "block", textTransform: "uppercase", letterSpacing: ".08em", color: "#777", fontSize: 9 }}>{routine ? "Edit source routine" : "New source routine"}</small>
        <strong style={{ fontSize: 18 }}>Repeats into real Clock time</strong>
        <span style={{ display: "block", fontSize: 11, color: "#777", marginTop: 3 }}>This defines dated reservations. It does not create recurring tasks.</span>
      </div>

      <label style={{ display: "grid", gap: 5, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800 }}>Label</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Lunch" style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9, minHeight: 44 }} />
      </label>
      <label style={{ display: "grid", gap: 5, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800 }}>Type</span>
        <select value={kind} onChange={(event) => setKind(event.target.value as AtlasDayReservationKind)} style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9, minHeight: 44 }}>
          <option value="routine">Routine</option>
          <option value="meal">Meal</option>
          <option value="external_commitment">External commitment</option>
        </select>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginBottom: 12 }}>
        <label style={{ display: "grid", gap: 5 }}><span style={{ fontSize: 11, fontWeight: 800 }}>Start</span><input type="time" step="300" value={startTime} onChange={(event) => setStartTime(event.target.value)} style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9, minHeight: 44, minWidth: 0 }} /></label>
        <label style={{ display: "grid", gap: 5 }}><span style={{ fontSize: 11, fontWeight: 800 }}>End</span><input type="time" step="300" value={end} onChange={(event) => setEnd(event.target.value)} style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9, minHeight: 44, minWidth: 0 }} /></label>
      </div>
      <fieldset style={{ border: 0, margin: "0 0 12px", padding: 0 }}>
        <legend style={{ fontSize: 11, fontWeight: 800, marginBottom: 6 }}>Repeats on</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,minmax(0,1fr))", gap: 5 }}>
          {WEEKDAYS.map((day) => {
            const selected = weekdays.includes(day.value);
            return <button key={day.value} type="button" aria-pressed={selected} aria-label={day.long} onClick={() => toggleWeekday(day.value)} style={{ minHeight: 42, border: selected ? "1px solid #626779" : "1px solid #d8d8dc", borderRadius: 8, background: selected ? "#eceef4" : "#fff", fontSize: 9, fontWeight: 800 }}>{day.short.slice(0, 1)}</button>;
          })}
        </div>
        <small style={{ display: "block", marginTop: 5, color: "#777" }}>{weekdaySummary(weekdays) || "Choose at least one day"}</small>
      </fieldset>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginBottom: 10 }}>
        <label style={{ display: "grid", gap: 5 }}><span style={{ fontSize: 11, fontWeight: 800 }}>Starts applying</span><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9, minHeight: 44, minWidth: 0 }} /></label>
        <label style={{ display: "grid", gap: 5 }}><span style={{ fontSize: 11, fontWeight: 800 }}>Final date <i style={{ fontWeight: 400 }}>optional</i></span><input type="date" value={effectiveThrough} onChange={(event) => setEffectiveThrough(event.target.value)} style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9, minHeight: 44, minWidth: 0 }} /></label>
      </div>
      <label style={{ display: "grid", gap: 5, marginBottom: 12 }}><span style={{ fontSize: 11, fontWeight: 800 }}>Operational note <i style={{ fontWeight: 400 }}>optional</i></span><input value={note} onChange={(event) => setNote(event.target.value)} style={{ padding: 10, border: "1px solid #d8d8dc", borderRadius: 9, minHeight: 44 }} /></label>

      {error ? <p style={{ color: "#9c3434", fontSize: 12, margin: "0 0 10px" }}>{error}</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={() => void save()} disabled={saving} style={{ flex: "1 1 180px", border: 0, borderRadius: 10, minHeight: 46, padding: 11, background: "#262833", color: "white", fontWeight: 800 }}>{saving ? "Saving…" : routine ? "Save routine" : "Create routine"}</button>
        {routine && !ended ? <button type="button" onClick={() => void endAfterToday()} disabled={saving} style={{ flex: "0 1 auto", border: "1px solid #d9d3c7", borderRadius: 10, minHeight: 46, padding: "11px 13px", background: "#fff", color: "#6f6250", fontWeight: 800 }}>End after {prettyDate(dateIso)}</button> : null}
        {routine && ended ? <button type="button" onClick={() => void resume()} disabled={saving} style={{ flex: "0 1 auto", border: "1px solid #cbd4c9", borderRadius: 10, minHeight: 46, padding: "11px 13px", background: "#fff", color: "#425c43", fontWeight: 800 }}>Resume routine</button> : null}
      </div>
    </div>
  );
}

export default function FixedRoutineManager({
  dateIso,
  focusRoutineId = null,
  onClose,
}: {
  dateIso: string;
  focusRoutineId?: string | null;
  onClose: () => void;
}) {
  const [routines, setRoutines] = useState<AtlasFixedRoutine[]>([]);
  const [workerLabel, setWorkerLabel] = useState("Farm Hand");
  const [selectedId, setSelectedId] = useState<string | "new" | null>(focusRoutineId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    try {
      const result = await readAtlasFixedRoutines();
      setRoutines(result.routines);
      setWorkerLabel(result.workerLabel || "Farm Hand");
      if (selectedId && selectedId !== "new" && !result.routines.some((routine) => routine.routineId === selectedId)) setSelectedId(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Atlas could not load repeating fixed times.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void reload(); }, []);

  const selected = selectedId && selectedId !== "new"
    ? routines.find((routine) => routine.routineId === selectedId) ?? null
    : null;
  const current = routines.filter((routine) => routine.active && (!routine.effectiveThrough || routine.effectiveThrough >= dateIso));
  const ended = routines.filter((routine) => !current.includes(routine));

  return (
    <div role="dialog" aria-modal="true" aria-label="Repeating fixed times" data-fixed-routine-manager="true" style={{ position: "fixed", inset: 0, zIndex: 140, background: "rgba(18,20,27,.42)", display: "grid", alignItems: "end" }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section style={{ background: "#fff", borderRadius: "18px 18px 0 0", padding: "18px max(18px, env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left))", boxShadow: "0 -12px 40px rgba(0,0,0,.18)", maxWidth: 560, width: "100%", margin: "0 auto", maxHeight: "90dvh", overflowY: "auto" }}>
        <header style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
          <div><small style={{ display: "block", textTransform: "uppercase", letterSpacing: ".08em", color: "#777", fontSize: 9 }}>Owner fixed routines</small><strong style={{ fontSize: 18 }}>Repeating fixed times</strong><span style={{ display: "block", fontSize: 11, color: "#777", marginTop: 3 }}>{workerLabel} · source rules that project into dated reservations</span></div>
          <button type="button" onClick={onClose} aria-label="Close routine manager" style={{ border: 0, background: "transparent", fontSize: 22, minWidth: 44, minHeight: 44 }}>×</button>
        </header>

        {selectedId ? (
          <RoutineForm
            routine={selectedId === "new" ? null : selected}
            dateIso={dateIso}
            onBack={() => setSelectedId(null)}
            onSaved={async () => { await reload(); setSelectedId(null); }}
          />
        ) : (
          <>
            <button type="button" onClick={() => setSelectedId("new")} style={{ width: "100%", minHeight: 46, border: "1px solid rgba(88,87,111,.14)", borderRadius: 10, background: "#f7f7fa", fontWeight: 800, marginBottom: 12 }}>+ New repeating fixed time</button>
            {loading ? <p style={{ fontSize: 12, color: "#777" }}>Loading routines…</p> : null}
            {error ? <p style={{ color: "#9c3434", fontSize: 12 }}>{error}</p> : null}
            {!loading && !current.length ? <p style={{ fontSize: 12, color: "#777", border: "1px dashed #ddd", borderRadius: 10, padding: 12 }}>No repeating fixed times are active for this worker.</p> : null}
            <div style={{ display: "grid", gap: 7 }}>
              {current.map((routine) => <button key={routine.routineId} type="button" onClick={() => setSelectedId(routine.routineId)} data-fixed-routine={routine.routineId} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, textAlign: "left", alignItems: "center", minHeight: 56, border: "1px solid #dddde2", borderRadius: 10, background: "#fff", padding: "9px 10px", color: "inherit" }}><span style={{ display: "grid", gap: 1 }}><strong style={{ fontSize: 12 }}>{routine.title}</strong><span style={{ fontSize: 10 }}>{routineTimeLabel(routine)} · {weekdaySummary(routine.weekdays)}</span><em style={{ fontSize: 9, fontStyle: "normal", color: "#777" }}>{typeLabel(routine.kind)}{routine.effectiveFrom > dateIso ? ` · begins ${prettyDate(routine.effectiveFrom)}` : ""}</em></span><span aria-hidden="true" style={{ fontSize: 18, color: "#888" }}>›</span></button>)}
            </div>
            {ended.length ? <details style={{ marginTop: 14 }}><summary style={{ fontSize: 11, fontWeight: 800, cursor: "pointer", minHeight: 36 }}>Ended routines ({ended.length})</summary><div style={{ display: "grid", gap: 7, marginTop: 6 }}>{ended.map((routine) => <button key={routine.routineId} type="button" onClick={() => setSelectedId(routine.routineId)} style={{ display: "grid", textAlign: "left", gap: 1, border: "1px solid #e4e4e7", borderRadius: 9, background: "#fafafa", padding: "9px 10px", color: "inherit" }}><strong style={{ fontSize: 11 }}>{routine.title}</strong><span style={{ fontSize: 10 }}>{routineTimeLabel(routine)} · {weekdaySummary(routine.weekdays)}</span><em style={{ fontSize: 9, fontStyle: "normal", color: "#888" }}>{routine.effectiveThrough ? `Ended ${prettyDate(routine.effectiveThrough)}` : "Inactive"}</em></button>)}</div></details> : null}
          </>
        )}
      </section>
    </div>
  );
}
