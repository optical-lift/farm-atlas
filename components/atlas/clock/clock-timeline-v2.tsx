import Link from "next/link";

import type { AtlasClockTaskLayout, AtlasClockTaskRange } from "@/lib/atlas/clock-layout";
import { clockLocalMinuteOfDay } from "@/lib/atlas/clock-layout";
import type { AtlasDaySequenceItem } from "@/lib/atlas/day-sequence";
import { DEFAULT_ATLAS_FARM_TIME_ZONE } from "@/lib/atlas/farm-day";

import ClockOwnerControls from "./clock-owner-controls";
import styles from "./clock-surface-v2.module.css";

type Cue = Extract<AtlasDaySequenceItem, { kind: "cue" }>;

const HOUR_HEIGHT = 64;

function minuteLabel(value: number) {
  const minute = ((Math.round(value) % 1440) + 1440) % 1440;
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function hourLabel(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  if (normalized === 0) return "12 AM";
  if (normalized === 12) return "12 PM";
  return normalized > 12 ? `${normalized - 12} PM` : `${normalized} AM`;
}

function taskHref(taskId: string, dateIso: string) {
  const returnTo = `/clock?date=${encodeURIComponent(dateIso)}`;
  return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(returnTo)}`;
}

export default function ClockTimelineV2(props: {
  dateIso: string;
  canManage: boolean;
  layouts: AtlasClockTaskLayout[];
  timedCues: Cue[];
  activeRange: AtlasClockTaskRange | null;
  selectedToday: boolean;
  nowMinute: number | null;
  startHour: number;
  endHour: number;
  gridHeight: number;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const hours = Array.from({ length: props.endHour - props.startHour + 1 }, (_, index) => props.startHour + index);
  const offsetForMinute = (minute: number) => ((minute - props.startHour * 60) / 60) * HOUR_HEIGHT;

  return <section className={styles.gridShell} aria-label="Clock timeline">
    <header><h2>Time</h2><span>Exact starts + planned spans</span></header>
    <div className={styles.grid} style={{ height: props.gridHeight }} data-clock-duration-blocks="true">
      {hours.map((hour) => <div className={styles.hour} style={{ top: (hour - props.startHour) * HOUR_HEIGHT }} key={hour}><span>{hourLabel(hour)}</span></div>)}
      {props.selectedToday && props.nowMinute !== null ? <div className={styles.now} style={{ top: offsetForMinute(props.nowMinute) }} data-clock-now-line="true"><span>NOW</span></div> : null}
      {props.timedCues.map((item) => {
        const minute = clockLocalMinuteOfDay(item.scheduledAt, DEFAULT_ATLAS_FARM_TIME_ZONE);
        if (minute === null) return null;
        return <div className={styles.cue} style={{ top: offsetForMinute(minute) }} key={item.id} data-clock-timed-cue="true"><i aria-hidden="true" /><div><small>{minuteLabel(minute)} · Cue</small><strong>{item.title}</strong>{item.body ? <span>{item.body}</span> : null}</div></div>;
      })}
      {props.layouts.map((layout) => {
        const item = layout.item;
        const height = layout.span.minutes ? Math.max(38, (layout.span.minutes / 60) * HOUR_HEIGHT - 2) : 42;
        const available = "calc(100% - 69px)";
        const left = layout.laneCount === 1 ? "61px" : `calc(61px + (${available} * ${layout.laneIndex} / ${layout.laneCount}))`;
        const width = layout.laneCount === 1 ? "calc(100% - 69px)" : `calc((${available} / ${layout.laneCount}) - 4px)`;
        return <div className={styles.timedTask} style={{ top: offsetForMinute(layout.startMinute), height, left, width }} key={item.id} data-clock-timed-task="true" data-clock-planned-span={layout.span.minutes ? "true" : "false"} data-active={props.activeRange?.item.id === item.id ? "true" : "false"} data-conflict={layout.conflict ? "true" : "false"}>
          <Link href={item.taskId ? taskHref(item.taskId, props.dateIso) : `/clock?date=${props.dateIso}`}><small>{layout.span.minutes ? `${minuteLabel(layout.startMinute)}–${minuteLabel(layout.endMinute)}` : `${minuteLabel(layout.startMinute)} · Start only`}</small><strong>{item.title}</strong>{item.location ? <span>{item.location}</span> : null}{layout.conflict ? <span className={styles.conflictNote}>Overlaps another planned block</span> : null}</Link>
          <ClockOwnerControls item={item} dateIso={props.dateIso} canManage={props.canManage} onChanged={props.onChanged} onError={props.onError} showTime compact />
        </div>;
      })}
    </div>
  </section>;
}
