"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { buildClockTaskRanges, chooseClockNextTask, clockLocalMinuteOfDay, layoutClockTaskRanges } from "@/lib/atlas/clock-layout";
import type { AtlasDaySequence, AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";
import { atlasFarmDateIso, atlasNormalizeFarmDate, DEFAULT_ATLAS_FARM_TIME_ZONE } from "@/lib/atlas/farm-day";

import ClockHeaderV2 from "./clock-header-v2";
import { readOwnerClockSequence } from "./clock-owner-reader";
import ClockTimelineV2 from "./clock-timeline-v2";
import ClockUnplacedV2 from "./clock-unplaced-v2";
import { readWorkerClockSequence } from "./clock-worker-reader";
import styles from "./clock-surface-v2.module.css";

type CommittedItem = Extract<AtlasDaySequenceItem, { kind: "committed_task" }>;
type CueItem = Extract<AtlasDaySequenceItem, { kind: "cue" }>;

function timeLabel(value: Date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_ATLAS_FARM_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(value);
}

async function readClock(dateIso: string) {
  const ownerSequence = await readOwnerClockSequence(dateIso);
  if (ownerSequence) return { sequence: ownerSequence, canManage: true };
  return { sequence: await readWorkerClockSequence(dateIso), canManage: false };
}

export default function ClockOrchestrator() {
  const searchParams = useSearchParams();
  const dateIso = atlasNormalizeFarmDate(searchParams.get("date"));
  const [sequence, setSequence] = useState<AtlasDaySequence | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());

  async function reload() {
    const value = await readClock(dateIso);
    setSequence(value.sequence);
    setCanManage(value.canManage);
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setSaveError(null);
    void readClock(dateIso).then((value) => {
      if (!alive) return;
      setSequence(value.sequence);
      setCanManage(value.canManage);
    }).catch((failure) => {
      if (!alive) return;
      setSequence(null);
      setCanManage(false);
      setError(failure instanceof Error ? failure.message : "Clock could not load.");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [dateIso]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo(() => (sequence?.items ?? []).filter((item) => item.kind !== "potential_task"), [sequence]);
  const committed = useMemo(() => items.filter((item): item is CommittedItem => item.kind === "committed_task"), [items]);
  const timedCues = useMemo(() => items.filter((item): item is CueItem => item.kind === "cue" && item.positionResolved && item.anchorKind === "at_time" && Boolean(item.scheduledAt) && !["resolved", "dismissed", "stale"].includes(item.status)), [items]);
  const ranges = useMemo(() => buildClockTaskRanges(committed, { timeZone: DEFAULT_ATLAS_FARM_TIME_ZONE }), [committed]);
  const layouts = useMemo(() => layoutClockTaskRanges(ranges), [ranges]);
  const today = atlasFarmDateIso(now);
  const selectedToday = dateIso === today;
  const nowMinute = selectedToday ? clockLocalMinuteOfDay(now.toISOString(), DEFAULT_ATLAS_FARM_TIME_ZONE) : null;
  const activeRange = selectedToday && nowMinute !== null ? ranges.find((range) => Boolean(range.span.minutes) && range.startMinute <= nowMinute && range.endMinute > nowMinute && range.item.status !== "done" && range.item.status !== "completed") ?? null : null;
  const nextTask = chooseClockNextTask(committed, ranges, selectedToday ? nowMinute : null);
  const nextRange = nextTask ? ranges.find((range) => range.item.id === nextTask.id) ?? null : null;
  const cueMinutes = timedCues.map((item) => clockLocalMinuteOfDay(item.scheduledAt, DEFAULT_ATLAS_FARM_TIME_ZONE)).filter((value): value is number => value !== null);
  const taskMinutes = ranges.flatMap((range) => range.span.minutes ? [range.startMinute, range.endMinute] : [range.startMinute]);
  const allMinutes = [...taskMinutes, ...cueMinutes];
  const floorMinute = Math.min(360, ...(allMinutes.length ? allMinutes : [360]), ...(nowMinute !== null ? [nowMinute] : []));
  const ceilingMinute = Math.max(1320, ...(allMinutes.length ? allMinutes : [1320]), ...(nowMinute !== null ? [nowMinute] : []));
  const startHour = Math.max(0, Math.floor(floorMinute / 60));
  const endHour = Math.min(24, Math.max(startHour + 1, Math.ceil(ceilingMinute / 60)));
  const gridHeight = (endHour - startHour) * 64;

  return <main className="atlas-phone-shell">
    <section className={`atlas-phone ${styles.phone}`}>
      <header className="atlas-phone-top"><Link href="/" className="atlas-phone-brand"><span className="atlas-phone-kicker">Atlas</span><span className="atlas-phone-title">Clock</span></Link></header>
      <div className={styles.body}>
        <ClockHeaderV2 dateIso={dateIso} selectedToday={selectedToday} nowLabel={timeLabel(now)} activeRange={activeRange} nextTask={nextTask} nextRange={nextRange} loading={loading} />
        {error ? <div className={styles.error}>{error}</div> : null}
        {saveError ? <div className={styles.error}>{saveError}</div> : null}
        <ClockTimelineV2 dateIso={dateIso} canManage={canManage} layouts={layouts} timedCues={timedCues} activeRange={activeRange} selectedToday={selectedToday} nowMinute={nowMinute} startHour={startHour} endHour={endHour} gridHeight={gridHeight} onChanged={reload} onError={setSaveError} />
        <ClockUnplacedV2 items={items} dateIso={dateIso} canManage={canManage} loading={loading} onChanged={reload} onError={setSaveError} />
      </div>
    </section>
  </main>;
}
