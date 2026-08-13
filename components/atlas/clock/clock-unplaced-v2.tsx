import Link from "next/link";

import type { AtlasDaySequenceItem, AtlasDaySequenceWindow } from "@/lib/atlas/day-sequence";

import ClockOwnerControls from "./clock-owner-controls";
import styles from "./clock-surface-v2.module.css";

const windowLabels: Record<AtlasDaySequenceWindow, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

function minutesLabel(value: number | null) {
  if (!value) return null;
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function taskHref(taskId: string, dateIso: string) {
  const returnTo = `/clock?date=${encodeURIComponent(dateIso)}`;
  return `/task-focus/${encodeURIComponent(taskId)}?returnTo=${encodeURIComponent(returnTo)}`;
}

export default function ClockUnplacedV2(props: {
  items: AtlasDaySequenceItem[];
  dateIso: string;
  canManage: boolean;
  loading: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const unplaced = props.items.filter((item) => item.kind === "committed_task" ? !item.plannedStartAt : item.kind === "cue" && item.positionResolved && item.anchorKind !== "at_time" && !["resolved", "dismissed", "stale"].includes(item.status));
  return <section className={styles.unplaced} aria-label="Unplaced today">
    <header><h2>Unplaced today</h2><span>{unplaced.filter((item) => item.kind === "committed_task").length} tasks need a time</span></header>
    <div className={styles.unplacedList} data-clock-unplaced-today="true">
      {props.loading ? <div className={styles.empty}>Loading the shared Day sequence…</div> : null}
      {!props.loading && !unplaced.length ? <div className={styles.empty}>Nothing is waiting for a clock time.</div> : null}
      {unplaced.map((item, index) => {
        const previous = unplaced[index - 1];
        const showWindow = item.dayWindow && (!previous || previous.dayWindow !== item.dayWindow);
        return <div key={item.id}>{showWindow ? <div className={styles.window}>{windowLabels[item.dayWindow as AtlasDaySequenceWindow]}</div> : null}{item.kind === "committed_task" ? <div className={styles.taskShell} data-complete={item.status === "done" || item.status === "completed" ? "true" : "false"}><Link className={styles.task} href={item.taskId ? taskHref(item.taskId, props.dateIso) : `/clock?date=${props.dateIso}`}><small>{item.automatic ? "Committed · automatic" : "Committed"}{minutesLabel(item.estimatedMinutes) ? ` · ${minutesLabel(item.estimatedMinutes)}` : ""}</small><strong>{item.title}</strong>{item.location ? <span>{item.location}</span> : null}</Link><ClockOwnerControls item={item} dateIso={props.dateIso} canManage={props.canManage} onChanged={props.onChanged} onError={props.onError} showTime /></div> : item.kind === "cue" ? <div className={styles.sequenceCue}><small>Cue · {item.anchorKind.replaceAll("_", " ")}</small><strong>{item.title}</strong></div> : null}</div>;
      })}
    </div>
  </section>;
}
