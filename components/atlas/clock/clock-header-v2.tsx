import Link from "next/link";

import type { AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";
import { atlasFarmDateLabel, atlasShiftFarmDate, DEFAULT_ATLAS_FARM_TIME_ZONE } from "@/lib/atlas/farm-day";
import type { AtlasClockTaskRange } from "@/lib/atlas/clock-layout";

import styles from "./clock-surface-v2.module.css";

type Item = Extract<AtlasDaySequenceItem, { kind: "committed_task" }>;

function minuteLabel(value: number) {
  const minute = ((Math.round(value) % 1440) + 1440) % 1440;
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

export default function ClockHeaderV2(props: {
  dateIso: string;
  selectedToday: boolean;
  nowLabel: string;
  activeRange: AtlasClockTaskRange | null;
  nextTask: Item | null;
  nextRange: AtlasClockTaskRange | null;
  loading: boolean;
}) {
  const previousDate = atlasShiftFarmDate(props.dateIso, -1);
  const nextDate = atlasShiftFarmDate(props.dateIso, 1);
  return <section className={styles.head}>
    <nav className={styles.mode} aria-label="Work view"><Link href={`/day?date=${encodeURIComponent(props.dateIso)}`}>Day</Link><Link href={`/clock?date=${encodeURIComponent(props.dateIso)}`} aria-current="page">Clock</Link></nav>
    <div className={styles.dateNav}><Link href={`/clock?date=${previousDate}`} aria-label="Previous day">←</Link><div><strong>{atlasFarmDateLabel(props.dateIso, { weekday: "long", month: "short", day: "numeric" })}</strong><span>Elm Farm · {DEFAULT_ATLAS_FARM_TIME_ZONE}</span></div><Link href={`/clock?date=${nextDate}`} aria-label="Next day">→</Link></div>
    <div className={styles.status}>
      <article><small>NOW</small><strong>{props.activeRange?.item.title ?? (props.selectedToday ? props.nowLabel : "Not this day")}</strong><span>{props.activeRange ? `${minuteLabel(props.activeRange.startMinute)}–${minuteLabel(props.activeRange.endMinute)}` : props.selectedToday ? "No planned block is active right now." : "NOW follows the real Elm Farm service day."}</span></article>
      <article><small>NEXT</small><strong>{props.nextTask?.title ?? (props.loading ? "Loading…" : "No remaining work")}</strong><span>{props.nextRange ? props.nextRange.span.minutes ? `${minuteLabel(props.nextRange.startMinute)}–${minuteLabel(props.nextRange.endMinute)}` : `Starts ${minuteLabel(props.nextRange.startMinute)}` : props.nextTask ? props.nextTask.dayWindow : "Shared Day sequence"}</span></article>
    </div>
  </section>;
}
