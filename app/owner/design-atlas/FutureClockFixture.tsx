"use client";

import smartStyles from "../clock-day-lab/smart-day-study.module.css";
import styles from "./future-clock-fixture.module.css";

type MoveRole = "last" | "now" | "next" | "then";

type RailTask = {
  id: string;
  label: string;
  minute: number;
};

type OccupiedSpan = {
  id: string;
  label: string;
  startMinute: number;
  endMinute: number;
  timeLabel: string;
};

type Move = {
  id: string;
  role: MoveRole;
  family: string;
  title: string;
  detail: string;
  timeLabel: string;
};

const DAY_START_MINUTE = 8 * 60;
const DAY_END_MINUTE = 20 * 60;
const NOW_MINUTE = 13 * 60 + 34;
const NOW_LABEL = "1:34 PM";

const OCCUPIED: OccupiedSpan[] = [
  {
    id: "supplier-window",
    label: "Supplier delivery window",
    startMinute: 9 * 60 + 40,
    endMinute: 10 * 60,
    timeLabel: "9:40–10:00 AM",
  },
  {
    id: "pickup-at-elm",
    label: "Pickup at Elm",
    startMinute: 16 * 60 + 30,
    endMinute: 17 * 60,
    timeLabel: "4:30–5:00 PM",
  },
];

const RAIL_TASKS: RailTask[] = [
  { id: "farm-round", label: "Farm Round", minute: 8 * 60 },
  { id: "weekly-harvest", label: "Harvest Weekly Stems", minute: 11 * 60 + 30 },
  { id: "condition-bunch", label: "Condition + bunch flowers", minute: 13 * 60 + 10 },
  { id: "little-clay-delivery", label: "Deliver 5 posies", minute: 14 * 60 + 15 },
  { id: "weed-mg7", label: "Weed MG7", minute: 15 * 60 },
  { id: "water-planters", label: "Water outdoor planters", minute: 17 * 60 + 10 },
  { id: "spray-bb10", label: "Spray BB10", minute: 19 * 60 },
];

const MOVES: Move[] = [
  {
    id: "weekly-harvest",
    role: "last",
    family: "HARVEST",
    title: "Harvest Weekly Stems",
    detail: "Field + Barn Beds",
    timeLabel: "Done · 12:58 PM",
  },
  {
    id: "condition-bunch",
    role: "now",
    family: "FLOWER PREP",
    title: "Condition + bunch flowers",
    detail: "Zinnias · celosia · lemon basil · sunflowers",
    timeLabel: "1:10–2:00 PM",
  },
  {
    id: "little-clay-delivery",
    role: "next",
    family: "DELIVERY",
    title: "Deliver 5 posies",
    detail: "Little Clay House",
    timeLabel: "2:15–2:40 PM",
  },
  {
    id: "weed-mg7",
    role: "then",
    family: "WEED",
    title: "MG7",
    detail: "Main Garden",
    timeLabel: "3:00–3:45 PM",
  },
];

const HARD_EDGE = OCCUPIED[1];

function railPosition(minute: number) {
  const raw = (minute - DAY_START_MINUTE) / (DAY_END_MINUTE - DAY_START_MINUTE);
  return Math.max(0, Math.min(1, raw)) * 100;
}

function railWidth(startMinute: number, endMinute: number) {
  return Math.max(0, railPosition(endMinute) - railPosition(startMinute));
}

function FullDayRail() {
  return (
    <section className={smartStyles.dayRailPanel} aria-label={`Full-day time rail fixture, now ${NOW_LABEL}`}>
      <header className={smartStyles.dayRailHeader}>
        <span>8 AM</span>
        <strong>FULL DAY</strong>
        <span>8 PM</span>
      </header>
      <div className={smartStyles.dayRail}>
        <i className={smartStyles.dayRailBase} aria-hidden="true" />
        {OCCUPIED.map((span) => (
          <i
            className={smartStyles.occupiedSpan}
            style={{ left: `${railPosition(span.startMinute)}%`, width: `${railWidth(span.startMinute, span.endMinute)}%` }}
            title={`${span.label} · ${span.timeLabel}`}
            aria-hidden="true"
            key={span.id}
          />
        ))}
        {RAIL_TASKS.map((task) => (
          <i
            className={smartStyles.railTaskDot}
            style={{ left: `${railPosition(task.minute)}%` }}
            title={task.label}
            aria-hidden="true"
            key={task.id}
          />
        ))}
        <b className={smartStyles.railNowDot} style={{ left: `${railPosition(NOW_MINUTE)}%` }} aria-hidden="true" />
        <small className={smartStyles.railNowLabel} style={{ left: `${railPosition(NOW_MINUTE)}%` }}>{NOW_LABEL}</small>
      </div>
    </section>
  );
}

function MoveCard({ move }: { move: Move }) {
  return (
    <article className={smartStyles.executionMove} data-role={move.role} data-task-id={move.id}>
      <div className={smartStyles.moveRole}><span>{move.role.toUpperCase()}</span></div>
      <div className={smartStyles.moveIdentity}>
        <span>{move.family}</span>
        <strong>{move.title}</strong>
        <small>{move.detail}</small>
      </div>
      <time>{move.timeLabel}</time>
    </article>
  );
}

export default function FutureClockFixture() {
  return (
    <section
      className={styles.clock}
      data-atlas-future-clock="clock-study-15"
      data-clock-day-source="execution-neighborhood"
      data-live-data-binding="none"
      data-mutation-capability="none"
    >
      <section className={smartStyles.executionSurface} aria-label="Chosen future Clock execution neighborhood fixture">
        <header className={smartStyles.dateHeader}>
          <div><span>FRIDAY</span><strong>Aug 28</strong></div>
          <small>CLOCK</small>
        </header>

        <FullDayRail />

        <section className={smartStyles.executionNeighborhood} data-scenario="normal">
          <header className={smartStyles.executionHeader}>
            <div>
              <span>EXECUTION NEIGHBORHOOD</span>
              <strong>NOW · {NOW_LABEL}</strong>
            </div>
            <small>Day owns everything else</small>
          </header>

          <div className={smartStyles.executionStack}>
            {MOVES.map((move) => <MoveCard move={move} key={`${move.role}-${move.id}`} />)}
          </div>

          <section className={smartStyles.hardEdge} aria-label={`Next hard edge, ${HARD_EDGE.label}, ${HARD_EDGE.timeLabel}`}>
            <div>
              <span>NEXT HARD EDGE</span>
              <strong>{HARD_EDGE.label}</strong>
            </div>
            <time>{HARD_EDGE.timeLabel}</time>
          </section>
        </section>
      </section>

      <details className={styles.behaviorContract}>
        <summary>
          <span>FUTURE BEHAVIOR CONTRACT</span>
          <strong>What this quiet surface is allowed to do</strong>
          <b aria-hidden="true">⌄</b>
        </summary>
        <div>
          <article><b>DAY OWNS THE WHOLE DAY</b><span>The thin rail preserves the complete service day, including occupied human time and fixed commitments.</span></article>
          <article><b>CLOCK OWNS THE HANDS</b><span>LAST / NOW / NEXT / THEN is the worker&apos;s immediate temporal neighborhood, not another task board.</span></article>
          <article><b>REALITY REFLOWS QUIETLY</b><span>If work runs long, Atlas re-fits movable work around fixed truth before adding explanation to the screen.</span></article>
          <article><b>CONFLICT EARNS UI</b><span>Clock speaks when time custody cannot be resolved silently. Unresolved work is carried, rescheduled, expired, or sent to management rather than disappearing.</span></article>
        </div>
      </details>
    </section>
  );
}
