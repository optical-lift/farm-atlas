"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  assembleWorkerDaySequence,
  type AtlasDaySequence,
  type AtlasDaySequenceCueInput,
  type AtlasDaySequenceItem,
  type AtlasDaySequencePlacementInput,
  type AtlasDaySequencePlanRowInput,
  type AtlasDaySequenceWindow,
} from "@/lib/atlas/day-sequence";
import { atlasFarmDateIso, atlasFarmDateLabel, atlasNormalizeFarmDate, atlasShiftFarmDate, DEFAULT_ATLAS_FARM_TIME_ZONE } from "@/lib/atlas/farm-day";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import { fetchAtlasTaskCards, type AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { atlasWorkOrderAnchorForTask, atlasWorkOrderNumber } from "@/lib/atlas/work-order";

type OwnerSequenceResponse = { ok?: boolean; active?: boolean; sequence?: AtlasDaySequence | null };
type ChoreographyResponse = {
  ok?: boolean;
  active?: boolean;
  choreography?: {
    placements?: AtlasDaySequencePlacementInput[];
    cues?: AtlasDaySequenceCueInput[];
  } | null;
};
type ClockRead = { sequence: AtlasDaySequence; canManage: boolean };

const HOUR_HEIGHT = 64;
const hiddenCueStatuses = new Set(["resolved", "dismissed", "stale"]);
const windowLabels: Record<AtlasDaySequenceWindow, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

function isChildTask(task: AtlasTaskCard) {
  return Boolean(task.parent_task_id)
    || task.metadata?.is_child_task === true
    || task.metadata?.is_child_task === "true";
}

function isClockTask(task: AtlasTaskCard) {
  return task.status !== "archived" && task.status !== "skipped" && !isChildTask(task);
}

function dayWindowForTask(task: AtlasTaskCard): AtlasDaySequenceWindow {
  const anchor = atlasWorkOrderAnchorForTask(task);
  if (anchor === "top" || anchor === "morning") return "morning";
  if (anchor === "midday" || anchor === "visibility") return "afternoon";
  return "evening";
}

function metadataMinutes(task: AtlasTaskCard) {
  for (const key of ["expected_active_minutes", "estimated_minutes", "duration_minutes"]) {
    const value = task.metadata?.[key];
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return null;
}

function taskPlanRow(task: AtlasTaskCard): AtlasDaySequencePlanRowInput {
  const display = atlasTaskDisplay(task);
  return {
    id: `clock:${task.task_id}`,
    kind: "real",
    sourceKind: "task",
    sourceId: task.task_id,
    taskId: task.task_id,
    title: display.title,
    note: display.detail || task.note,
    status: task.status,
    location: task.zone_label || display.location || null,
    expectedActiveMinutes: metadataMinutes(task),
    dayWindow: dayWindowForTask(task),
    workOrderNumber: atlasWorkOrderNumber(task),
    automatic: false,
    requiresOwnerApproval: false,
  };
}

function cueVisible(item: AtlasDaySequenceItem) {
  return item.kind === "cue" && item.positionResolved && !hiddenCueStatuses.has(item.status);
}

function itemExactTime(item: AtlasDaySequenceItem) {
  if (item.kind === "cue") return item.anchorKind === "at_time" ? item.scheduledAt : null;
  if (item.kind === "committed_task") return item.plannedStartAt;
  return null;
}

function localMinuteOfDay(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_ATLAS_FARM_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function clockTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_ATLAS_FARM_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function clockTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_ATLAS_FARM_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  return hour && minute ? `${hour}:${minute}` : "";
}

function hourLabel(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  if (normalized === 0) return "12 AM";
  if (normalized === 12) return "12 PM";
  return normalized > 12 ? `${normalized - 12} PM` : `${normalized} AM`;
}

function minutesLabel(value: number | null) {
  if (!value) return null;
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function dateHref(dateIso: string) {
  return `/clock?date=${encodeURIComponent(dateIso)}`;
}

function taskHref(taskId: string, dateIso: string) {
  const returnTo = dateHref(dateIso);
  return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(returnTo)}`;
}

async function readOwnerSequence(dateIso: string) {
  const response = await fetch(`/api/atlas/worker-day-sequence?date=${encodeURIComponent(dateIso)}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const body = await response.json() as OwnerSequenceResponse;
  return body.ok && body.active && body.sequence ? body.sequence : null;
}

async function readWorkerSequence(dateIso: string) {
  const today = atlasFarmDateIso();
  const [taskResponse, choreographyRequest] = await Promise.all([
    fetchAtlasTaskCards({
      viewerScoped: true,
      dueThrough: dateIso,
      doneDate: dateIso,
      exactDate: dateIso > today ? dateIso : undefined,
    }),
    fetch(`/api/atlas/day-choreography?date=${encodeURIComponent(dateIso)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }),
  ]);

  const choreographyBody = await choreographyRequest.json() as ChoreographyResponse;
  if (!choreographyRequest.ok || !choreographyBody.ok || !choreographyBody.active) {
    throw new Error("Atlas could not load the worker Day choreography.");
  }

  const realWork = taskResponse.taskCards.filter(isClockTask).map(taskPlanRow);
  return assembleWorkerDaySequence({
    serviceDate: dateIso,
    realWork,
    suggestions: [],
    placements: choreographyBody.choreography?.placements ?? [],
    cues: choreographyBody.choreography?.cues ?? [],
  });
}

async function readClockSequence(dateIso: string): Promise<ClockRead> {
  const ownerSequence = await readOwnerSequence(dateIso);
  if (ownerSequence) return { sequence: ownerSequence, canManage: true };
  return { sequence: await readWorkerSequence(dateIso), canManage: false };
}

export default function ClockSurface() {
  const searchParams = useSearchParams();
  const dateIso = atlasNormalizeFarmDate(searchParams.get("date"));
  const [sequence, setSequence] = useState<AtlasDaySequence | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [timeDrafts, setTimeDrafts] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => new Date());

  async function reload() {
    const value = await readClockSequence(dateIso);
    setSequence(value.sequence);
    setCanManage(value.canManage);
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setSaveError(null);
    void readClockSequence(dateIso)
      .then((value) => {
        if (!alive) return;
        setSequence(value.sequence);
        setCanManage(value.canManage);
      })
      .catch((loadError) => {
        if (!alive) return;
        setSequence(null);
        setCanManage(false);
        setError(loadError instanceof Error ? loadError.message : "Clock could not load.");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [dateIso]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo(
    () => (sequence?.items ?? []).filter((item) => item.kind !== "potential_task"),
    [sequence],
  );
  const committed = useMemo(
    () => items.filter((item) => item.kind === "committed_task"),
    [items],
  );
  const timedItems = useMemo(
    () => items.filter((item) => {
      if (item.kind === "committed_task") return Boolean(item.plannedStartAt);
      return cueVisible(item) && item.kind === "cue" && item.anchorKind === "at_time" && Boolean(item.scheduledAt);
    }),
    [items],
  );
  const unplaced = useMemo(
    () => items.filter((item) => {
      if (item.kind === "committed_task") return !item.plannedStartAt;
      return cueVisible(item) && item.kind === "cue" && item.anchorKind !== "at_time";
    }),
    [items],
  );
  const nextTask = committed.find((item) => item.status !== "done" && item.status !== "completed") ?? null;
  const today = atlasFarmDateIso(now);
  const selectedToday = dateIso === today;
  const nowMinute = selectedToday ? localMinuteOfDay(now.toISOString()) : null;
  const timedMinutes = timedItems
    .map((item) => localMinuteOfDay(itemExactTime(item)))
    .filter((value): value is number => value !== null);
  const floorMinute = Math.min(6 * 60, ...(timedMinutes.length ? timedMinutes : [6 * 60]), ...(nowMinute !== null ? [nowMinute] : []));
  const ceilingMinute = Math.max(22 * 60, ...(timedMinutes.length ? timedMinutes : [22 * 60]), ...(nowMinute !== null ? [nowMinute] : []));
  const startHour = Math.max(0, Math.floor(floorMinute / 60));
  const endHour = Math.min(24, Math.max(startHour + 1, Math.ceil(ceilingMinute / 60) + (ceilingMinute % 60 === 0 ? 0 : 1)));
  const gridHeight = (endHour - startHour) * HOUR_HEIGHT;
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  const previousDate = atlasShiftFarmDate(dateIso, -1);
  const nextDate = atlasShiftFarmDate(dateIso, 1);

  function offsetForMinute(minute: number) {
    return ((minute - startHour * 60) / 60) * HOUR_HEIGHT;
  }

  function draftFor(taskId: string, plannedStartAt: string | null) {
    return timeDrafts[taskId] ?? clockTimeInput(plannedStartAt);
  }

  async function saveTaskTime(taskId: string, localTime: string | null) {
    setSavingTaskId(taskId);
    setSaveError(null);
    try {
      const response = await fetch("/api/atlas/owner-day-task-time", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-atlas-intent": "owner-clock-time-v1",
        },
        body: JSON.stringify({ date: dateIso, taskId, localTime }),
      });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || "Atlas could not update this Clock placement.");
      setTimeDrafts((current) => {
        const next = { ...current };
        delete next[taskId];
        return next;
      });
      await reload();
    } catch (saveFailure) {
      setSaveError(saveFailure instanceof Error ? saveFailure.message : "Atlas could not update this Clock placement.");
    } finally {
      setSavingTaskId(null);
    }
  }

  function TimeControls({ item, placed }: { item: Extract<AtlasDaySequenceItem, { kind: "committed_task" }>; placed: boolean }) {
    if (!canManage || !item.taskId) return null;
    const value = draftFor(item.taskId, item.plannedStartAt);
    const saving = savingTaskId === item.taskId;
    return (
      <div className="atlas-clock-time-controls" data-clock-owner-time-controls="true">
        <input
          type="time"
          value={value}
          aria-label={`Start time for ${item.title}`}
          onChange={(event) => setTimeDrafts((current) => ({ ...current, [item.taskId as string]: event.target.value }))}
        />
        <button type="button" disabled={!value || saving} onClick={() => void saveTaskTime(item.taskId as string, value)}>
          {saving ? "Saving…" : placed ? "Save time" : "Place"}
        </button>
        {placed ? <button className="atlas-clock-remove-time" type="button" disabled={saving} onClick={() => void saveTaskTime(item.taskId as string, null)}>Remove time</button> : null}
      </div>
    );
  }

  return (
    <>
      <style>{`
        .atlas-clock-phone{padding-bottom:92px}.atlas-clock-body{padding:14px;display:grid;gap:14px}.atlas-clock-head{display:grid;gap:10px}.atlas-clock-mode{display:grid;grid-template-columns:1fr 1fr;padding:3px;border:1px solid rgba(112,111,177,.18);border-radius:12px;background:rgba(246,244,252,.64)}.atlas-clock-mode a{padding:7px 10px;border-radius:9px;color:#686b87;text-align:center;text-decoration:none;font-size:11px;font-weight:900}.atlas-clock-mode a[aria-current="page"]{background:#fff;color:#3f4267;box-shadow:0 1px 4px rgba(55,51,74,.08)}.atlas-clock-date-nav{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px}.atlas-clock-date-nav a{color:#6d7096;text-decoration:none;font-size:18px;font-weight:900}.atlas-clock-date-nav div{text-align:center}.atlas-clock-date-nav strong{display:block;font-size:15px}.atlas-clock-date-nav span{display:block;margin-top:2px;color:#7b7d88;font-size:10px}.atlas-clock-status{display:grid;grid-template-columns:1fr 1fr;gap:8px}.atlas-clock-status article{padding:10px 11px;border:1px solid rgba(112,111,177,.13);border-radius:12px;background:rgba(255,255,255,.68)}.atlas-clock-status small{display:block;color:#7b80a7;font-size:8px;font-weight:950;letter-spacing:.12em}.atlas-clock-status strong{display:block;margin-top:3px;font-size:11.5px;line-height:1.2}.atlas-clock-status span{display:block;margin-top:2px;color:#7a7b86;font-size:9px;line-height:1.2}.atlas-clock-grid-shell{display:grid;gap:7px}.atlas-clock-grid-shell>header,.atlas-clock-unplaced>header{display:flex;align-items:end;justify-content:space-between;gap:10px}.atlas-clock-grid-shell h2,.atlas-clock-unplaced h2{margin:0;font-size:13px}.atlas-clock-grid-shell header span,.atlas-clock-unplaced header span{color:#858691;font-size:9px}.atlas-clock-grid{position:relative;margin-left:0;border:1px solid rgba(99,100,112,.12);border-radius:14px;background:rgba(255,255,255,.58);overflow:hidden}.atlas-clock-hour{position:absolute;left:0;right:0;border-top:1px solid rgba(92,94,106,.1)}.atlas-clock-hour span{position:absolute;top:-6px;left:7px;width:42px;padding-right:5px;background:#fbfaf4;color:#8a8b94;font-size:8px;text-align:right}.atlas-clock-hour::after{content:"";position:absolute;left:55px;right:0;top:-1px;border-top:1px solid rgba(92,94,106,.06)}.atlas-clock-now{position:absolute;z-index:8;left:50px;right:0;border-top:1.5px solid #8b91c2}.atlas-clock-now::before{content:"";position:absolute;left:-3px;top:-4px;width:7px;height:7px;border-radius:50%;background:#8b91c2}.atlas-clock-now span{position:absolute;right:7px;top:-14px;padding:2px 4px;background:#fbfaf4;color:#696e9d;font-size:8px;font-weight:950}.atlas-clock-cue{position:absolute;z-index:6;left:61px;right:8px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;align-items:center;transform:translateY(-50%)}.atlas-clock-cue i{width:8px;height:8px;background:#747b9b;transform:rotate(45deg)}.atlas-clock-cue div{min-width:0;padding:6px 8px;border-left:1px solid rgba(91,99,137,.26);background:rgba(251,250,244,.94)}.atlas-clock-cue small{display:block;color:#737a9b;font-size:8px;font-weight:950;letter-spacing:.08em;text-transform:uppercase}.atlas-clock-cue strong{display:block;margin-top:1px;font-size:10.5px;line-height:1.12}.atlas-clock-cue span{display:block;margin-top:1px;color:#7d7e89;font-size:8.5px}.atlas-clock-timed-task{position:absolute;z-index:4;left:61px;right:8px;transform:translateY(-6px);padding:7px 8px;border:1px solid rgba(107,108,118,.17);border-left:3px solid rgba(108,112,160,.54);border-radius:10px;background:rgba(255,255,255,.95);box-shadow:0 1px 4px rgba(55,51,74,.06)}.atlas-clock-timed-task>a{display:block;color:#303243;text-decoration:none}.atlas-clock-timed-task small{display:block;color:#6f7395;font-size:8px;font-weight:950;text-transform:uppercase}.atlas-clock-timed-task strong{display:block;margin-top:1px;font-size:11px;line-height:1.12}.atlas-clock-timed-task span{display:block;margin-top:1px;color:#777983;font-size:8.5px}.atlas-clock-unplaced{display:grid;gap:8px}.atlas-clock-unplaced-list{position:relative;display:grid;gap:0;padding-left:22px}.atlas-clock-unplaced-list::before{content:"";position:absolute;left:7px;top:9px;bottom:9px;border-left:1px solid rgba(91,99,137,.18)}.atlas-clock-window{margin:8px 0 5px -22px;color:#7b80a7;font-size:8px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.atlas-clock-task-shell{position:relative;margin:0 0 7px;padding:9px 10px;border:1px solid rgba(107,108,118,.15);border-radius:12px;background:rgba(255,255,255,.78)}.atlas-clock-task-shell::before{content:"";position:absolute;left:-19px;top:13px;width:8px;height:8px;border:1.5px solid rgba(92,95,115,.48);border-radius:50%;background:#f7f4e9;box-shadow:0 0 0 3px #f7f4e9}.atlas-clock-task-shell[data-complete="true"]{opacity:.58}.atlas-clock-task{display:block;color:#303243;text-decoration:none}.atlas-clock-task small{display:block;color:#7a7c8a;font-size:8px;font-weight:900;text-transform:uppercase}.atlas-clock-task strong{display:block;margin-top:2px;font-size:12px;line-height:1.12}.atlas-clock-task span{display:block;margin-top:2px;color:#777983;font-size:9px}.atlas-clock-sequence-cue{position:relative;margin:0 0 8px;padding:5px 0 6px 9px;border-top:1px solid rgba(91,99,137,.2)}.atlas-clock-sequence-cue::before{content:"";position:absolute;left:-18px;top:5px;width:7px;height:7px;background:#747b9b;box-shadow:0 0 0 3px #f7f4e9;transform:rotate(45deg)}.atlas-clock-sequence-cue small{display:block;color:#737a9b;font-size:8px;font-weight:950;text-transform:uppercase}.atlas-clock-sequence-cue strong{display:block;margin-top:1px;font-size:10.5px}.atlas-clock-time-controls{display:flex;align-items:center;gap:5px;margin-top:7px;padding-top:6px;border-top:1px solid rgba(107,108,118,.10)}.atlas-clock-time-controls input{min-width:0;width:86px;padding:5px 6px;border:1px solid rgba(104,106,124,.23);border-radius:7px;background:#fff;color:#343646;font:inherit;font-size:10px}.atlas-clock-time-controls button{padding:5px 7px;border:1px solid rgba(104,106,124,.20);border-radius:7px;background:#f2f1f8;color:#535777;font-size:9px;font-weight:900}.atlas-clock-time-controls button:disabled{opacity:.45}.atlas-clock-time-controls .atlas-clock-remove-time{margin-left:auto;background:transparent;color:#7d686a}.atlas-clock-error,.atlas-clock-save-error,.atlas-clock-empty{padding:12px;border:1px solid rgba(107,108,118,.13);border-radius:12px;color:#747681;font-size:10px}.atlas-clock-error,.atlas-clock-save-error{color:#8b514b;background:rgba(218,178,168,.12)}
      `}</style>
      <main className="atlas-phone-shell atlas-clock-shell">
        <section className="atlas-phone atlas-clock-phone">
          <header className="atlas-phone-top">
            <Link href="/" className="atlas-phone-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Clock</span></Link>
          </header>
          <div className="atlas-clock-body">
            <section className="atlas-clock-head">
              <nav className="atlas-clock-mode" aria-label="Work view">
                <Link href={`/day?date=${encodeURIComponent(dateIso)}`}>Day</Link>
                <Link href={dateHref(dateIso)} aria-current="page">Clock</Link>
              </nav>
              <div className="atlas-clock-date-nav">
                <Link href={dateHref(previousDate)} aria-label="Previous day">←</Link>
                <div><strong>{atlasFarmDateLabel(dateIso, { weekday: "long", month: "short", day: "numeric" })}</strong><span>Elm Farm · {DEFAULT_ATLAS_FARM_TIME_ZONE}</span></div>
                <Link href={dateHref(nextDate)} aria-label="Next day">→</Link>
              </div>
              <div className="atlas-clock-status">
                <article><small>NOW</small><strong>{selectedToday ? (clockTime(now.toISOString()) ?? "Now") : "Not this day"}</strong><span>{selectedToday ? "Exact committed starts and timed cues land on this line." : "NOW follows the real Elm Farm service day."}</span></article>
                <article><small>NEXT</small><strong>{nextTask?.title ?? (loading ? "Loading…" : "No remaining work")}</strong><span>{nextTask ? windowLabels[nextTask.dayWindow] : "Shared Day sequence"}</span></article>
              </div>
            </section>

            {error ? <div className="atlas-clock-error">{error}</div> : null}
            {saveError ? <div className="atlas-clock-save-error">{saveError}</div> : null}

            <section className="atlas-clock-grid-shell" aria-label="Clock timeline">
              <header><h2>Time</h2><span>Exact Elm Farm time truth</span></header>
              <div className="atlas-clock-grid" style={{ height: gridHeight }} data-clock-no-invented-task-times="true">
                {hours.map((hour) => <div className="atlas-clock-hour" style={{ top: (hour - startHour) * HOUR_HEIGHT }} key={hour}><span>{hourLabel(hour)}</span></div>)}
                {selectedToday && nowMinute !== null ? <div className="atlas-clock-now" style={{ top: offsetForMinute(nowMinute) }} data-clock-now-line="true"><span>NOW</span></div> : null}
                {timedItems.map((item) => {
                  const exactTime = itemExactTime(item);
                  const minute = localMinuteOfDay(exactTime);
                  if (minute === null) return null;
                  if (item.kind === "cue") {
                    return <div className="atlas-clock-cue" style={{ top: offsetForMinute(minute) }} key={item.id} data-clock-timed-cue="true"><i aria-hidden="true" /><div><small>{clockTime(item.scheduledAt)} · Cue</small><strong>{item.title}</strong>{item.body ? <span>{item.body}</span> : null}</div></div>;
                  }
                  if (item.kind !== "committed_task") return null;
                  return <div className="atlas-clock-timed-task" style={{ top: offsetForMinute(minute) }} key={item.id} data-clock-timed-task="true"><Link href={item.taskId ? taskHref(item.taskId, dateIso) : dateHref(dateIso)}><small>{clockTime(item.plannedStartAt)} · Committed</small><strong>{item.title}</strong>{item.location ? <span>{item.location}</span> : null}</Link><TimeControls item={item} placed /></div>;
                })}
              </div>
            </section>

            <section className="atlas-clock-unplaced" aria-label="Unplaced today">
              <header><h2>Unplaced today</h2><span>{unplaced.filter((item) => item.kind === "committed_task").length} tasks need a time</span></header>
              <div className="atlas-clock-unplaced-list" data-clock-unplaced-today="true">
                {loading ? <div className="atlas-clock-empty">Loading the shared Day sequence…</div> : null}
                {!loading && !unplaced.length ? <div className="atlas-clock-empty">Nothing is waiting for a clock time.</div> : null}
                {unplaced.map((item, index) => {
                  const previous = unplaced[index - 1];
                  const showWindow = item.dayWindow && (!previous || previous.dayWindow !== item.dayWindow);
                  return <div key={item.id}>{showWindow ? <div className="atlas-clock-window">{windowLabels[item.dayWindow as AtlasDaySequenceWindow]}</div> : null}{item.kind === "committed_task" ? <div className="atlas-clock-task-shell" data-complete={item.status === "done" || item.status === "completed" ? "true" : "false"}><Link className="atlas-clock-task" href={item.taskId ? taskHref(item.taskId, dateIso) : dateHref(dateIso)}><small>{item.automatic ? "Committed · automatic" : "Committed"}{minutesLabel(item.estimatedMinutes) ? ` · ${minutesLabel(item.estimatedMinutes)}` : ""}</small><strong>{item.title}</strong>{item.location ? <span>{item.location}</span> : null}</Link><TimeControls item={item} placed={false} /></div> : item.kind === "cue" ? <div className="atlas-clock-sequence-cue"><small>Cue · {item.anchorKind.replaceAll("_", " ")}</small><strong>{item.title}</strong></div> : null}</div>;
                })}
              </div>
            </section>
          </div>
        </section>
      </main>
    </>
  );
}
