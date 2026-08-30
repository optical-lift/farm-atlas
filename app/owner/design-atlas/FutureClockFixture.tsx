"use client";

import WorkerClockSurface from "@/components/atlas/clock/worker-clock-surface";
import type {
  WorkerClockMove,
  WorkerClockRailTask,
  WorkerClockReservation,
} from "@/components/atlas/clock/worker-clock-surface";
import styles from "./future-clock-fixture.module.css";

type WorkerPersona = "anna" | "marshall";
type ClockScenario = {
  reservations: WorkerClockReservation[];
  railTasks: WorkerClockRailTask[];
  moves: WorkerClockMove[];
  hardEdgeId: string;
};

const DAY_START_MINUTE = 8 * 60;
const DAY_END_MINUTE = 20 * 60;
const NOW_MINUTE = 13 * 60 + 34;
const NOW_LABEL = "1:34 PM";

const SCENARIOS: Record<WorkerPersona, ClockScenario> = {
  anna: {
    reservations: [
      { id: "supplier-window", label: "Supplier delivery window", kind: "span", startMinute: 9 * 60 + 40, endMinute: 10 * 60, timeLabel: "9:40–10:00 AM" },
      { id: "pickup-at-elm", label: "Pickup at Elm", kind: "span", startMinute: 16 * 60 + 30, endMinute: 17 * 60, timeLabel: "4:30–5:00 PM" },
    ],
    railTasks: [
      { id: "farm-round", label: "Farm Round", minute: 8 * 60 },
      { id: "weekly-harvest", label: "Harvest Weekly Stems", minute: 11 * 60 + 30 },
      { id: "condition-bunch", label: "Condition + bunch flowers", minute: 13 * 60 + 10 },
      { id: "little-clay-delivery", label: "Deliver 5 posies", minute: 14 * 60 + 15 },
      { id: "weed-mg7", label: "Weed MG7", minute: 15 * 60 },
      { id: "water-planters", label: "Water outdoor planters", minute: 17 * 60 + 10 },
      { id: "spray-bb10", label: "Spray BB10", minute: 19 * 60 },
    ],
    moves: [
      { id: "weekly-harvest", role: "last", family: "HARVEST", title: "Harvest Weekly Stems", detail: "Field + Barn Beds", timeLabel: "Done · 12:58 PM" },
      { id: "condition-bunch", role: "now", family: "FLOWER PREP", title: "Condition + bunch flowers", detail: "Zinnias · celosia · lemon basil · sunflowers", timeLabel: "1:10–2:00 PM" },
      { id: "little-clay-delivery", role: "next", family: "DELIVERY", title: "Deliver 5 posies", detail: "Springfield distribution", timeLabel: "2:15–2:40 PM" },
      { id: "weed-mg7", role: "then", family: "WEED", title: "MG7", detail: "Main Garden", timeLabel: "3:00–3:45 PM" },
    ],
    hardEdgeId: "pickup-at-elm",
  },
  marshall: {
    reservations: [
      { id: "hardware-window", label: "Hardware pickup window", kind: "span", startMinute: 11 * 60 + 45, endMinute: 12 * 60 + 15, timeLabel: "11:45 AM–12:15 PM" },
      { id: "electrician", label: "Meet electrician", kind: "span", startMinute: 16 * 60 + 30, endMinute: 17 * 60, timeLabel: "4:30–5:00 PM" },
    ],
    railTasks: [
      { id: "property-round", label: "Property round", minute: 8 * 60 },
      { id: "orchard-edge", label: "Mow orchard edge", minute: 9 * 60 },
      { id: "barn-door", label: "Adjust north barn door", minute: 13 * 60 + 10 },
      { id: "hinge-hardware", label: "Pick up hinge hardware", minute: 14 * 60 + 15 },
      { id: "gate-latch", label: "Replace west gate latch", minute: 15 * 60 },
      { id: "pavilion-lights", label: "Check pavilion lights", minute: 17 * 60 + 10 },
      { id: "irrigation-check", label: "Verify irrigation close", minute: 19 * 60 },
    ],
    moves: [
      { id: "orchard-edge", role: "last", family: "GROUNDS", title: "Mow orchard edge", detail: "Orchard", timeLabel: "Done · 12:52 PM" },
      { id: "barn-door", role: "now", family: "REPAIR", title: "Adjust north barn door", detail: "Barn · tools on site", timeLabel: "1:10–2:00 PM" },
      { id: "hinge-hardware", role: "next", family: "PICKUP", title: "Pick up hinge hardware", detail: "Marshfield", timeLabel: "2:15–2:40 PM" },
      { id: "gate-latch", role: "then", family: "REPAIR", title: "Replace west gate latch", detail: "Entry", timeLabel: "3:00–3:45 PM" },
    ],
    hardEdgeId: "electrician",
  },
};

export default function FutureClockFixture({ persona = "anna" }: { persona?: WorkerPersona }) {
  const scenario = SCENARIOS[persona];
  const hardEdgeReservation = scenario.reservations.find((item) => item.id === scenario.hardEdgeId) ?? scenario.reservations[scenario.reservations.length - 1];
  const hardEdge = hardEdgeReservation ? { id: hardEdgeReservation.id, label: hardEdgeReservation.label, timeLabel: hardEdgeReservation.timeLabel } : null;

  return (
    <section
      className={styles.clock}
      data-atlas-future-clock="clock-study-15"
      data-clock-day-source="execution-neighborhood"
      data-atlas-clock-persona={persona}
      data-live-data-binding="none"
      data-mutation-capability="none"
    >
      <WorkerClockSurface
        weekdayLabel="SATURDAY"
        dateLabel="Aug 29"
        dayStartMinute={DAY_START_MINUTE}
        dayEndMinute={DAY_END_MINUTE}
        nowMinute={NOW_MINUTE}
        nowLabel={NOW_LABEL}
        reservations={scenario.reservations}
        railTasks={scenario.railTasks}
        moves={scenario.moves}
        hardEdge={hardEdge}
        ariaLabel="Chosen future Clock execution neighborhood fixture"
      />

      <details className={styles.behaviorContract}>
        <summary><span>FUTURE BEHAVIOR CONTRACT</span><strong>Study 15 appearance + current execution rules</strong><b aria-hidden="true">⌄</b></summary>
        <div>
          <article><b>DAY OWNS THE WHOLE DAY</b><span>The thin rail preserves the complete service day, including occupied human time and fixed commitments.</span></article>
          <article><b>CLOCK OWNS THE HANDS</b><span>LAST / NOW / NEXT / THEN is the worker&apos;s immediate temporal neighborhood, not another task board.</span></article>
          <article><b>REALITY REFLOWS QUIETLY</b><span>If work runs long, Atlas re-fits movable work around fixed truth before adding explanation to the screen.</span></article>
          <article><b>CONFLICT EARNS UI</b><span>Unresolved work is carried, rescheduled, expired, held, or sent to management rather than disappearing.</span></article>
        </div>
      </details>
    </section>
  );
}
