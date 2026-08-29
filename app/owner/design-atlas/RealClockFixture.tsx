"use client";

import clockStyles from "@/components/atlas/clock/clock-surface-v2.module.css";
import styles from "./real-clock-fixture.module.css";

type ClockBlock = {
  id: string;
  start: number;
  end: number;
  title: string;
  place: string;
  timing: "fixed" | "windowed" | "anchored" | "flexible";
  active?: boolean;
};

const HOUR_HEIGHT = 64;
const START_HOUR = 6;
const END_HOUR = 20;
const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const NOW_MINUTE = 8 * 60 + 18;

const BLOCKS: ClockBlock[] = [
  { id: "round", start: 390, end: 420, title: "Saturday Farm Round", place: "Elm Farm", timing: "fixed" },
  { id: "harvest", start: 420, end: 465, title: "Harvest ProCut Orange sunflower", place: "Field Rows", timing: "windowed" },
  { id: "weed", start: 480, end: 510, title: "Weed Field Row 13", place: "Field Rows", timing: "windowed", active: true },
  { id: "transplant", start: 525, end: 570, title: "Transplant cabbage into MG7", place: "Main Garden", timing: "windowed" },
  { id: "sow", start: 585, end: 615, title: "Sow ProCut White Lite", place: "Barn Beds", timing: "anchored" },
  { id: "setup", start: 630, end: 655, title: "String the next Barn Bed", place: "Barn Beds", timing: "flexible" },
  { id: "venue", start: 780, end: 815, title: "Reset Farmhouse for workshop", place: "Farmhouse", timing: "fixed" },
  { id: "pickup", start: 840, end: 870, title: "Stage florist pickups", place: "Flower Room", timing: "fixed" },
  { id: "delivery", start: 900, end: 945, title: "Deliver sample flowers", place: "Springfield route", timing: "fixed" },
  { id: "mow", start: 1155, end: 1190, title: "Mow orchard edge", place: "Orchard", timing: "windowed" },
];

function minuteLabel(value: number) {
  const minute = ((Math.round(value) % 1440) + 1440) % 1440;
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function hourLabel(hour: number) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

export default function RealClockFixture() {
  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index);
  const offsetForMinute = (minute: number) => ((minute - START_HOUR * 60) / 60) * HOUR_HEIGHT;
  const active = BLOCKS.find((block) => block.active) ?? null;
  const next = BLOCKS.find((block) => block.start > NOW_MINUTE) ?? null;

  return (
    <section className={styles.fixture} data-atlas-clock-fixture="real-skin">
      <section className={clockStyles.head}>
        <nav className={clockStyles.mode} aria-label="Fixture work view"><button type="button">Day</button><button type="button" aria-current="page">Clock</button></nav>
        <div className={clockStyles.dateNav}><button type="button" aria-label="Previous pretend day">←</button><div><strong>Saturday, Aug 29</strong><span>Elm Farm · America/Chicago</span></div><button type="button" aria-label="Next pretend day">→</button></div>
        <div className={clockStyles.status}>
          <article><small>NOW</small><strong>{active?.title ?? "8:18 PM"}</strong><span>{active ? `${minuteLabel(active.start)}–${minuteLabel(active.end)}` : "No planned block is active right now."}</span></article>
          <article><small>NEXT</small><strong>{next?.title ?? "No remaining work"}</strong><span>{next ? `${minuteLabel(next.start)}–${minuteLabel(next.end)}` : "Shared Day sequence"}</span></article>
        </div>
      </section>

      <section className={clockStyles.gridShell} aria-label="Pretend Clock timeline">
        <header><h2>Time</h2><span>Exact starts + planned spans</span></header>
        <div className={clockStyles.grid} style={{ height: GRID_HEIGHT }} data-clock-duration-blocks="true">
          {hours.map((hour) => <div className={clockStyles.hour} style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }} key={hour}><span>{hourLabel(hour)}</span></div>)}
          <div className={clockStyles.now} style={{ top: offsetForMinute(NOW_MINUTE) }} data-clock-now-line="true"><span>NOW</span></div>
          <div className={clockStyles.cue} style={{ top: offsetForMinute(12 * 60 + 45) }} data-clock-timed-cue="true" data-timing-class="fixed"><i aria-hidden="true"/><div><small>12:45 PM · Cue · Fixed</small><strong>Switch to venue mode</strong><span>Farmhouse reset begins at 1:00 PM</span></div></div>
          {BLOCKS.map((block) => {
            const height = Math.max(38, ((block.end - block.start) / 60) * HOUR_HEIGHT - 2);
            return (
              <div
                className={clockStyles.timedTask}
                style={{ top: offsetForMinute(block.start), height, left: "61px", width: "calc(100% - 69px)", overflow: "hidden" }}
                key={block.id}
                data-clock-timed-task="true"
                data-clock-planned-span="true"
                data-active={block.active ? "true" : "false"}
                data-timing-class={block.timing}
              >
                <button type="button" className={styles.blockButton}>
                  <small>{minuteLabel(block.start)}–{minuteLabel(block.end)}</small>
                  <span className={clockStyles.mobility}>{block.timing}</span>
                  <strong>{block.title}</strong>
                  <span>{block.place}</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className={clockStyles.unplaced}>
        <header><h2>Still in the day</h2><span>Not forced onto a clock time</span></header>
        <div className={clockStyles.unplacedList}>
          <div className={clockStyles.window}>Flexible</div>
          <article className={clockStyles.taskShell} data-timing-class="flexible"><button type="button" className={styles.unplacedButton}><small>Flexible · Evening</small><strong>Condition tomorrow’s harvest buckets</strong><span>Flower Room</span></button></article>
        </div>
      </section>
    </section>
  );
}
