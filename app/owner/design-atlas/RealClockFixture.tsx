"use client";

import ClockHeaderV2 from "@/components/atlas/clock/clock-header-v2";
import ClockTimelineV2 from "@/components/atlas/clock/clock-timeline-v2";
import ClockUnplacedV2 from "@/components/atlas/clock/clock-unplaced-v2";
import { buildClockTaskRanges, layoutClockTaskRanges } from "@/lib/atlas/clock-layout";
import type { AtlasCommittedDaySequenceItem } from "@/lib/atlas/day-sequence";
import { deriveAtlasTimingMobility, type AtlasTimingConstraintClass } from "@/lib/atlas/timing-mobility";
import styles from "./real-clock-fixture.module.css";

const DATE_ISO = "2026-08-29";
const START_HOUR = 6;
const END_HOUR = 20;
const GRID_HEIGHT = (END_HOUR - START_HOUR) * 64;
const NOW_MINUTE = 8 * 60 + 18;

function timestamp(minute: number) {
  const hour = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${DATE_ISO}T${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00-05:00`;
}

function fakeCommitted(
  id: string,
  title: string,
  location: string,
  startMinute: number | null,
  durationMinutes: number,
  timingClass: AtlasTimingConstraintClass,
  sequenceOrder: number,
): AtlasCommittedDaySequenceItem {
  return {
    kind: "committed_task",
    id,
    sourceRowId: `fixture:${id}`,
    sourceKind: "fixture",
    sourceId: id,
    taskId: null,
    title,
    note: null,
    status: "open",
    workRoute: null,
    location,
    environment: null,
    estimatedMinutes: durationMinutes,
    dayWindow: startMinute !== null && startMinute >= 17 * 60 ? "evening" : startMinute !== null && startMinute >= 12 * 60 ? "afternoon" : "morning",
    sequenceOrder,
    commitmentState: "committed",
    automatic: false,
    reason: "Fixture-only Design Atlas work.",
    commitmentKind: null,
    preferredWindowStart: null,
    preferredWindowEnd: null,
    safeWindowEnd: null,
    timingWarning: null,
    placementId: startMinute === null ? null : `fixture-placement:${id}`,
    plannedStartAt: startMinute === null ? null : timestamp(startMinute),
    plannedDurationMinutes: durationMinutes,
    mobility: deriveAtlasTimingMobility({ metadata: { timing_class: timingClass }, location }),
    positionResolved: true,
  };
}

const COMMITTED: AtlasCommittedDaySequenceItem[] = [
  fakeCommitted("round", "Saturday Farm Round", "Elm Farm", 390, 30, "fixed", 1),
  fakeCommitted("harvest", "Harvest ProCut Orange sunflower", "Field Rows", 420, 45, "windowed", 2),
  fakeCommitted("weed", "Weed Field Row 13", "Field Rows", 480, 30, "windowed", 3),
  fakeCommitted("transplant", "Transplant cabbage into MG7", "Main Garden", 525, 45, "windowed", 4),
  fakeCommitted("sow", "Sow ProCut White Lite", "Barn Beds", 585, 30, "anchored", 5),
  fakeCommitted("setup", "String the next Barn Bed", "Barn Beds", 630, 25, "flexible", 6),
  fakeCommitted("venue", "Reset Farmhouse for workshop", "Farmhouse", 780, 35, "fixed", 7),
  fakeCommitted("pickup", "Stage florist pickups", "Flower Room", 840, 30, "fixed", 8),
  fakeCommitted("delivery", "Deliver sample flowers", "Springfield route", 900, 45, "fixed", 9),
  fakeCommitted("mow", "Mow orchard edge", "Orchard", 1155, 35, "windowed", 10),
  fakeCommitted("buckets", "Condition tomorrow’s harvest buckets", "Flower Room", null, 20, "flexible", 11),
];

const RANGES = buildClockTaskRanges(COMMITTED);
const LAYOUTS = layoutClockTaskRanges(RANGES);
const ACTIVE_RANGE = RANGES.find((range) => range.item.id === "weed") ?? null;
const NEXT_TASK = COMMITTED.find((item) => item.id === "transplant") ?? null;
const NEXT_RANGE = RANGES.find((range) => range.item.id === "transplant") ?? null;

export default function RealClockFixture() {
  return (
    <section className={styles.fixture} data-atlas-clock-fixture="production-components" data-live-data-binding="none" data-mutation-capability="none">
      <ClockHeaderV2
        dateIso={DATE_ISO}
        selectedToday
        nowLabel="8:18 AM"
        activeRange={ACTIVE_RANGE}
        nextTask={NEXT_TASK}
        nextRange={NEXT_RANGE}
        loading={false}
      />
      <ClockTimelineV2
        dateIso={DATE_ISO}
        canManage={false}
        layouts={LAYOUTS}
        proposals={[]}
        timedCues={[]}
        dayReservations={[]}
        activeRange={ACTIVE_RANGE}
        selectedToday
        nowMinute={NOW_MINUTE}
        startHour={START_HOUR}
        endHour={END_HOUR}
        gridHeight={GRID_HEIGHT}
        onChanged={async () => undefined}
        onError={() => undefined}
      />
      <ClockUnplacedV2
        items={COMMITTED}
        dateIso={DATE_ISO}
        canManage={false}
        loading={false}
        onChanged={async () => undefined}
        onError={() => undefined}
      />
    </section>
  );
}
