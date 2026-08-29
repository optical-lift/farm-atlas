"use client";

import type { ReactNode } from "react";

import styles from "./active-outcome-studies.module.css";
import smartStyles from "./smart-day-study.module.css";

type MoveRole = "last" | "now" | "next" | "then";

type RailTaskPlacement = {
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

type ExecutionMove = {
  id: string;
  role: MoveRole;
  family: string;
  title: string;
  detail: string;
  timeLabel: string;
  resultLabel?: string;
};

type TemporalConflict = {
  title: string;
  detail: string;
  options: string[];
};

type ExecutionScenario = {
  id: "normal" | "reflow" | "conflict";
  studyLabel: string;
  studyNote: string;
  nowMinute: number;
  nowLabel: string;
  railTasks: RailTaskPlacement[];
  occupied: OccupiedSpan[];
  moves: ExecutionMove[];
  hardEdge: OccupiedSpan;
  conflict?: TemporalConflict;
};

const DAY_START_MINUTE = 8 * 60;
const DAY_END_MINUTE = 20 * 60;

const MORNING_SUPPLIER_WINDOW: OccupiedSpan = {
  id: "supplier-window",
  label: "Supplier delivery window",
  startMinute: 9 * 60 + 40,
  endMinute: 10 * 60,
  timeLabel: "9:40–10:00 AM",
};

const PICKUP_HARD_EDGE: OccupiedSpan = {
  id: "pickup-at-elm",
  label: "Pickup at Elm",
  startMinute: 16 * 60 + 30,
  endMinute: 17 * 60,
  timeLabel: "4:30–5:00 PM",
};

const SCENARIOS: ExecutionScenario[] = [
  {
    id: "normal",
    studyLabel: "A · Normal progression",
    studyNote: "Clock shows only the immediate execution neighborhood. The full day survives as a thin linear rail above it.",
    nowMinute: 13 * 60 + 34,
    nowLabel: "1:34 PM",
    railTasks: [
      { id: "farm-round", label: "Farm Round", minute: 8 * 60 },
      { id: "weekly-harvest", label: "Harvest Weekly Stems", minute: 11 * 60 + 30 },
      { id: "condition-bunch", label: "Condition + bunch flowers", minute: 13 * 60 + 10 },
      { id: "little-clay-delivery", label: "Deliver 5 posies", minute: 14 * 60 + 15 },
      { id: "weed-mg7", label: "Weed MG7", minute: 15 * 60 },
      { id: "water-planters", label: "Water outdoor planters", minute: 17 * 60 + 10 },
      { id: "spray-bb10", label: "Spray BB10", minute: 19 * 60 },
    ],
    occupied: [MORNING_SUPPLIER_WINDOW, PICKUP_HARD_EDGE],
    moves: [
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
    ],
    hardEdge: PICKUP_HARD_EDGE,
  },
  {
    id: "reflow",
    studyLabel: "B · Reality ran long",
    studyNote: "Flower conditioning finished 25 minutes late. Atlas silently refits movable work around the same fixed pickup instead of explaining the scheduling math.",
    nowMinute: 14 * 60 + 40,
    nowLabel: "2:40 PM",
    railTasks: [
      { id: "farm-round", label: "Farm Round", minute: 8 * 60 },
      { id: "weekly-harvest", label: "Harvest Weekly Stems", minute: 11 * 60 + 30 },
      { id: "condition-bunch", label: "Condition + bunch flowers", minute: 13 * 60 + 10 },
      { id: "little-clay-delivery", label: "Deliver 5 posies", minute: 14 * 60 + 40 },
      { id: "weed-mg7", label: "Weed MG7", minute: 15 * 60 + 15 },
      { id: "water-planters", label: "Water outdoor planters", minute: 17 * 60 + 10 },
      { id: "spray-bb10", label: "Spray BB10", minute: 19 * 60 },
    ],
    occupied: [MORNING_SUPPLIER_WINDOW, PICKUP_HARD_EDGE],
    moves: [
      {
        id: "condition-bunch",
        role: "last",
        family: "FLOWER PREP",
        title: "Condition + bunch flowers",
        detail: "Packing shed",
        timeLabel: "Done · 2:35 PM",
      },
      {
        id: "little-clay-delivery",
        role: "now",
        family: "DELIVERY",
        title: "Deliver 5 posies",
        detail: "Little Clay House",
        timeLabel: "2:40–3:05 PM",
      },
      {
        id: "weed-mg7",
        role: "next",
        family: "WEED",
        title: "MG7",
        detail: "Main Garden",
        timeLabel: "3:15–4:00 PM",
      },
      {
        id: "water-planters",
        role: "then",
        family: "WATER",
        title: "Outdoor planters",
        detail: "Elm Farm",
        timeLabel: "5:10–5:35 PM",
      },
    ],
    hardEdge: PICKUP_HARD_EDGE,
  },
  {
    id: "conflict",
    studyLabel: "C · Temporal conflict",
    studyNote: "Clock speaks only because time custody can no longer be resolved silently. MG7 is not falsely squeezed into an impossible gap.",
    nowMinute: 16 * 60 + 8,
    nowLabel: "4:08 PM",
    railTasks: [
      { id: "farm-round", label: "Farm Round", minute: 8 * 60 },
      { id: "weekly-harvest", label: "Harvest Weekly Stems", minute: 11 * 60 + 30 },
      { id: "condition-bunch", label: "Condition + bunch flowers", minute: 13 * 60 + 10 },
      { id: "little-clay-delivery", label: "Deliver 5 posies", minute: 14 * 60 + 40 },
      { id: "route-unload", label: "Return + unload route", minute: 15 * 60 + 40 },
      { id: "water-planters", label: "Water outdoor planters", minute: 17 * 60 + 10 },
      { id: "spray-bb10", label: "Spray BB10", minute: 19 * 60 },
    ],
    occupied: [MORNING_SUPPLIER_WINDOW, PICKUP_HARD_EDGE],
    moves: [
      {
        id: "route-unload",
        role: "last",
        family: "ROUTE",
        title: "Return + unload route",
        detail: "Elm Farm",
        timeLabel: "Done · 4:08 PM",
      },
      {
        id: "weed-mg7",
        role: "next",
        family: "WEED",
        title: "MG7",
        detail: "45 min · Main Garden",
        timeLabel: "Needs placement",
      },
    ],
    hardEdge: PICKUP_HARD_EDGE,
    conflict: {
      title: "MG7 needs 45 min.",
      detail: "22 min remain before Pickup at Elm · 4:30 PM.",
      options: ["Move after pickup", "Needs manager"],
    },
  },
];

function railPosition(minute: number) {
  const raw = (minute - DAY_START_MINUTE) / (DAY_END_MINUTE - DAY_START_MINUTE);
  return Math.max(0, Math.min(1, raw)) * 100;
}

function railWidth(startMinute: number, endMinute: number) {
  return Math.max(0, railPosition(endMinute) - railPosition(startMinute));
}

function AppHeader() {
  return (
    <header className={styles.appHeader}>
      <div><span>ATLAS</span><strong>Elm Farm</strong></div>
      <span>clear · 93°</span>
      <button type="button" disabled aria-label="Fixture exit to parent">×</button>
    </header>
  );
}

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.phone} ${smartStyles.executionPhone}`}>
      <AppHeader />
      {children}
      <footer className={styles.nav}>
        <span>Home</span><span>Work</span><strong>Clock</strong><span>Manager</span><span>More</span>
      </footer>
    </div>
  );
}

function DayRail({ scenario }: { scenario: ExecutionScenario }) {
  return (
    <section className={smartStyles.dayRailPanel} aria-label={`Full-day time rail fixture, now ${scenario.nowLabel}`}>
      <header className={smartStyles.dayRailHeader}>
        <span>8 AM</span>
        <strong>FULL DAY</strong>
        <span>8 PM</span>
      </header>
      <div className={smartStyles.dayRail}>
        <i className={smartStyles.dayRailBase} aria-hidden="true" />
        {scenario.occupied.map((span) => (
          <i
            className={smartStyles.occupiedSpan}
            style={{ left: `${railPosition(span.startMinute)}%`, width: `${railWidth(span.startMinute, span.endMinute)}%` }}
            title={`${span.label} · ${span.timeLabel}`}
            aria-hidden="true"
            key={span.id}
          />
        ))}
        {scenario.railTasks.map((task) => (
          <i
            className={smartStyles.railTaskDot}
            style={{ left: `${railPosition(task.minute)}%` }}
            title={task.label}
            aria-hidden="true"
            key={task.id}
          />
        ))}
        <b
          className={smartStyles.railNowDot}
          style={{ left: `${railPosition(scenario.nowMinute)}%` }}
          aria-hidden="true"
        />
        <small
          className={smartStyles.railNowLabel}
          style={{ left: `${railPosition(scenario.nowMinute)}%` }}
        >{scenario.nowLabel}</small>
      </div>
    </section>
  );
}

function ExecutionMoveCard({ move }: { move: ExecutionMove }) {
  return (
    <article className={smartStyles.executionMove} data-role={move.role} data-task-id={move.id}>
      <div className={smartStyles.moveRole}>
        <span>{move.role.toUpperCase()}</span>
        {move.resultLabel ? <small>{move.resultLabel}</small> : null}
      </div>
      <div className={smartStyles.moveIdentity}>
        <span>{move.family}</span>
        <strong>{move.title}</strong>
        <small>{move.detail}</small>
      </div>
      <time>{move.timeLabel}</time>
    </article>
  );
}

function HardEdge({ edge }: { edge: OccupiedSpan }) {
  return (
    <section className={smartStyles.hardEdge} aria-label={`Next hard edge, ${edge.label}, ${edge.timeLabel}`}>
      <div>
        <span>NEXT HARD EDGE</span>
        <strong>{edge.label}</strong>
      </div>
      <time>{edge.timeLabel}</time>
    </section>
  );
}

function ConflictCard({ conflict }: { conflict: TemporalConflict }) {
  return (
    <section className={smartStyles.temporalConflict} aria-label="Day conflict fixture">
      <span>DAY CONFLICT</span>
      <strong>{conflict.title}</strong>
      <p>{conflict.detail}</p>
      <div>
        {conflict.options.map((option) => <button type="button" disabled key={option}>{option}</button>)}
      </div>
    </section>
  );
}

function ExecutionNeighborhood({ scenario }: { scenario: ExecutionScenario }) {
  return (
    <section className={smartStyles.executionNeighborhood} data-scenario={scenario.id}>
      <header className={smartStyles.executionHeader}>
        <div>
          <span>EXECUTION NEIGHBORHOOD</span>
          <strong>NOW · {scenario.nowLabel}</strong>
        </div>
        <small>Day owns everything else</small>
      </header>
      <div className={smartStyles.executionStack}>
        {scenario.moves.map((move) => <ExecutionMoveCard move={move} key={`${scenario.id}-${move.role}-${move.id}`} />)}
        {scenario.conflict ? <ConflictCard conflict={scenario.conflict} /> : null}
      </div>
      <HardEdge edge={scenario.hardEdge} />
    </section>
  );
}

function ClockSurface({ scenario }: { scenario: ExecutionScenario }) {
  return (
    <section className={smartStyles.executionSurface} aria-label={`Clock execution-neighborhood fixture: ${scenario.studyLabel}`}>
      <header className={smartStyles.dateHeader}>
        <div><span>FRIDAY</span><strong>Aug 28</strong></div>
        <small>CLOCK</small>
      </header>
      <DayRail scenario={scenario} />
      <ExecutionNeighborhood scenario={scenario} />
    </section>
  );
}

function Study({ scenario }: { scenario: ExecutionScenario }) {
  return (
    <section className={styles.study}>
      <header className={styles.studyLabel}><strong>{scenario.studyLabel}</strong><span>{scenario.studyNote}</span></header>
      <Phone><ClockSurface scenario={scenario} /></Phone>
    </section>
  );
}

export default function ActiveOutcomeStudies() {
  return (
    <section
      className={styles.section}
      data-atlas-active-outcome-studies="fixture-only"
      data-live-task-binding="none"
      data-task-transition-capability="none"
      aria-labelledby="active-outcome-studies-heading"
    >
      <header className={styles.sectionHeader}>
        <span>CLOCK STUDY 15 · EXECUTION NEIGHBORHOOD</span>
        <h2 id="active-outcome-studies-heading">Clock keeps custody of the worker&apos;s hands.</h2>
        <p>Day owns the complete service day. Task Focus owns execution detail. Domain rails own downstream meaning. Clock now owns only the temporal neighborhood: what just finished, what is in hand, what comes next, and the next hard edge Atlas must respect.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>These three states are presentation specimens only. Nothing is wired to live Worker state and nothing can complete, move, reschedule, or mutate a real task. The same fixture task IDs recur across states to model canonical identity while the displayed choreography changes.</span>
      </div>
      <div className={smartStyles.executionStudyGrid}>
        {SCENARIOS.map((scenario) => <Study scenario={scenario} key={scenario.id} />)}
      </div>
    </section>
  );
}
