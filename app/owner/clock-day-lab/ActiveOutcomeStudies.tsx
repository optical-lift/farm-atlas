"use client";

import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type TouchEvent,
  type WheelEvent,
} from "react";

import styles from "./active-outcome-studies.module.css";
import smartStyles from "./smart-day-study.module.css";

type TaskDatum = {
  family: string;
  title: string;
  place: string;
  amount: string;
  time: string;
  minuteOfDay: number;
  durationMinutes: number;
  placementSource: "fixed" | "atlas-fit";
  unlock?: string;
};

type DayView = "clock" | "day";
type FocusTier = "focus" | "near" | "context";

const TASKS: TaskDatum[] = [
  {
    family: "STEWARDSHIP",
    title: "Farm Round · Elm Farm",
    place: "Elm Farm",
    amount: "Farm Round",
    time: "8:00 AM",
    minuteOfDay: 8 * 60,
    durationMinutes: 45,
    placementSource: "atlas-fit",
  },
  {
    family: "WEED",
    title: "MG11",
    place: "Main Garden",
    amount: "30 min · Heavy",
    time: "10:15 AM",
    minuteOfDay: 10 * 60 + 15,
    durationMinutes: 30,
    placementSource: "atlas-fit",
  },
  {
    family: "TIDY",
    title: "Farmhouse",
    place: "Interior",
    amount: "20 min · Standard",
    time: "1:30 PM",
    minuteOfDay: 13 * 60 + 30,
    durationMinutes: 20,
    placementSource: "atlas-fit",
    unlock: "Thursday Ticketed Night · Aug 27",
  },
  {
    family: "POT UP",
    title: "Sweet William",
    place: "Grow Room",
    amount: "3 trays · 600 plants",
    time: "4:06 PM",
    minuteOfDay: 16 * 60 + 6,
    durationMinutes: 50,
    placementSource: "atlas-fit",
    unlock: "Harvest Stems · May 6",
  },
  {
    family: "SPRAY",
    title: "BB10 · Bermuda Pass 1",
    place: "Barn Beds",
    amount: "20 min · Pass 1 of 3",
    time: "7:00 PM",
    minuteOfDay: 19 * 60,
    durationMinutes: 20,
    placementSource: "fixed",
    unlock: "Choose Overwintering Crop · Sep 15",
  },
];

const NOW_TASK_INDEX = 3;
const NOW_LABEL = "4:06 PM";
const SLIPPED_OUTCOME_TASK = TASKS[2];

// Fixture-only geometry for the compact smart rail. Production derives all
// three layers independently from governed Clock and result truth.
const SMART_PROGRESS_FRONTIER = 43;
const CURRENT_TIME_POSITION = 69;
const DAY_TASK_POSITIONS = [6, 13, 21, 29, 38, 47, 55, 64, 72, 84, 94];

// Chronicle-style focus + context geometry. Every task keeps a share of the
// bounded viewport. The inspected task gets the largest share, near neighbors
// get a medium share, and distant context compresses without disappearing.
function chronicleFocusWeight(distance: number) {
  if (distance === 0) return 4.2;
  if (distance === 1) return 2.15;
  if (distance === 2) return 1.25;
  return 0.78;
}

function focusDistanceTier(distance: number): FocusTier {
  if (distance === 0) return "focus";
  if (distance === 1) return "near";
  return "context";
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

function ViewToggle({ view, onChange }: { view: DayView; onChange: (view: DayView) => void }) {
  return (
    <div className={smartStyles.viewToggle} role="group" aria-label="Clock or day task-feed view">
      <button type="button" data-active={view === "clock" ? "true" : "false"} onClick={() => onChange("clock")}>Clock</button>
      <button type="button" data-active={view === "day" ? "true" : "false"} onClick={() => onChange("day")}>Day</button>
    </div>
  );
}

function DayHeader({ view, onChange }: { view: DayView; onChange: (view: DayView) => void }) {
  return (
    <section className={styles.dayHeader}>
      <div className={styles.dayHeaderTop}>
        <div className={styles.dayIdentity}>
          <span>WEDNESDAY</span>
          <strong>Aug 26</strong>
        </div>
        <ViewToggle view={view} onChange={onChange} />
      </div>
    </section>
  );
}

function DayNavigation({ position }: { position: "top" | "bottom" }) {
  return (
    <nav className={smartStyles.dayNavigation} data-position={position} aria-label={`${position} adjacent day navigation fixture`}>
      <button type="button">‹ Tue 25</button>
      <span>TODAY</span>
      <button type="button">Thu 27 ›</button>
    </nav>
  );
}

function SmartDayRail() {
  return (
    <div
      className={smartStyles.smartRail}
      aria-label="Fixture smart day rail: earned chronological progress, current time, and eleven task placements"
    >
      <i className={smartStyles.smartRailBase} aria-hidden="true" />
      <i
        className={smartStyles.smartRailProgress}
        style={{ width: `${SMART_PROGRESS_FRONTIER}%` }}
        aria-hidden="true"
      />
      {DAY_TASK_POSITIONS.map((position, index) => (
        <i
          className={smartStyles.smartRailTaskDot}
          style={{ left: `${position}%` }}
          aria-hidden="true"
          key={`${position}-${index}`}
        />
      ))}
      <b
        className={smartStyles.smartRailNowDot}
        style={{ left: `${CURRENT_TIME_POSITION}%` }}
        aria-hidden="true"
      />
      <small
        className={smartStyles.smartRailNowLabel}
        style={{ left: `${CURRENT_TIME_POSITION}%` }}
      >{NOW_LABEL}</small>
    </div>
  );
}

function ConsequenceRow() {
  return (
    <section className={smartStyles.consequenceRow} aria-label="Most consequential unresolved unlock fixture">
      <div className={smartStyles.consequenceSource}>
        <span>STILL OPEN</span>
        <strong>{SLIPPED_OUTCOME_TASK.family} · {SLIPPED_OUTCOME_TASK.title}</strong>
      </div>
      <div className={smartStyles.consequenceUnlock}>
        <i aria-hidden="true" />
        <div>
          <span>UNLOCKS</span>
          <strong>{SLIPPED_OUTCOME_TASK.unlock}</strong>
        </div>
      </div>
    </section>
  );
}

function DaySummaryPanel() {
  return (
    <section className={smartStyles.daySummaryPanel} aria-label="Atlas day summary fixture">
      <SmartDayRail />
      <div className={smartStyles.daySummaryDivider} aria-hidden="true" />
      <ConsequenceRow />
    </section>
  );
}

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.phone} ${smartStyles.boundedPhone}`}>
      <AppHeader />
      {children}
      <footer className={styles.nav}>
        <span>Home</span><span>Work</span><strong>Clock</strong><span>Manager</span><span>More</span>
      </footer>
    </div>
  );
}

function TaskIdentity({ task }: { task: TaskDatum }) {
  return (
    <div className={styles.taskIdentity}>
      <span>{task.family}</span>
      <strong>{task.title}</strong>
      <small>{task.place} · {task.amount}</small>
    </div>
  );
}

function UnlockBranch({ label }: { label: string }) {
  return (
    <div className={styles.unlockBranch}>
      <i aria-hidden="true" />
      <div><span>UNLOCKS</span><strong>{label}</strong></div>
    </div>
  );
}

function CalendarClockView({
  inspectedIndex,
  onInspect,
}: {
  inspectedIndex: number;
  onInspect: (index: number) => void;
}) {
  const wheelDebt = useRef(0);
  const touchY = useRef<number | null>(null);
  const inspectingNow = inspectedIndex === NOW_TASK_INDEX;

  function settleOn(index: number) {
    onInspect(Math.max(0, Math.min(TASKS.length - 1, index)));
  }

  function scrubBy(direction: -1 | 1) {
    settleOn(inspectedIndex + direction);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    wheelDebt.current += event.deltaY;
    if (Math.abs(wheelDebt.current) < 24) return;
    scrubBy(wheelDebt.current > 0 ? 1 : -1);
    wheelDebt.current = 0;
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchY.current = event.touches[0]?.clientY ?? null;
  }

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    const previous = touchY.current;
    const current = event.touches[0]?.clientY;
    if (previous === null || current === undefined) return;
    const delta = previous - current;
    if (Math.abs(delta) < 22) return;
    event.preventDefault();
    scrubBy(delta > 0 ? 1 : -1);
    touchY.current = current;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      scrubBy(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      scrubBy(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      settleOn(0);
    } else if (event.key === "End") {
      event.preventDefault();
      settleOn(TASKS.length - 1);
    }
  }

  return (
    <section className={smartStyles.clockView} aria-label="Bounded focus-and-context day-timer Clock fixture">
      <header className={smartStyles.clockViewHeader}>
        <div>
          <span>DAY TIMER · NOW {NOW_LABEL}</span>
          <strong>{inspectingNow ? `NOW · ${TASKS[NOW_TASK_INDEX].title}` : `INSPECTING · ${TASKS[inspectedIndex].time}`}</strong>
        </div>
        <button type="button" disabled={inspectingNow} onClick={() => settleOn(NOW_TASK_INDEX)}>Return to now</button>
      </header>

      <div
        className={smartStyles.clockLensViewport}
        role="slider"
        tabIndex={0}
        aria-label="Clock task scrubber"
        aria-valuemin={1}
        aria-valuemax={TASKS.length}
        aria-valuenow={inspectedIndex + 1}
        aria-valuetext={`${TASKS[inspectedIndex].time}, ${TASKS[inspectedIndex].title}`}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onKeyDown={handleKeyDown}
      >
        <div className={smartStyles.clockLensSpine} aria-hidden="true" />
        {TASKS.map((task, index) => {
          const distance = Math.abs(index - inspectedIndex);
          const isNow = index === NOW_TASK_INDEX;
          const isInspected = index === inspectedIndex;
          const tier = focusDistanceTier(distance);
          const weight = chronicleFocusWeight(distance);
          return (
            <div
              className={smartStyles.clockLensRow}
              data-focus-tier={tier}
              data-now={isNow ? "true" : "false"}
              style={{ flexGrow: weight }}
              key={`${task.time}-${task.title}`}
            >
              <span className={smartStyles.clockLensTime}>{task.time}</span>
              <i className={smartStyles.clockLensDot} aria-hidden="true" />
              <button
                className={smartStyles.calendarTaskBlock}
                data-inspected={isInspected ? "true" : "false"}
                data-now={isNow ? "true" : "false"}
                data-placement-source={task.placementSource}
                data-focus-tier={tier}
                type="button"
                onClick={() => settleOn(index)}
                aria-label={`Inspect ${task.time}, ${task.family}, ${task.title}`}
              >
                <span>{task.family}</span>
                <strong>{task.title}</strong>
                <small>{task.place} · {task.amount}</small>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OrderedTaskRail({ inspectedIndex }: { inspectedIndex: number }) {
  return (
    <div className={styles.cleanRail} aria-label="Ordered task rail fixture synchronized to Clock inspection">
      {TASKS.map((task, index) => {
        const isNow = index === NOW_TASK_INDEX;
        const isInspected = index === inspectedIndex;
        const stateClass = isNow
          ? smartStyles.feedNow
          : isInspected
            ? smartStyles.feedInspected
            : "";
        return (
          <article
            className={`${styles.cleanNode} ${stateClass}`}
            data-active={isNow ? "true" : "false"}
            data-inspected={isInspected ? "true" : "false"}
            key={task.title}
          >
            <i className={styles.railDot} aria-hidden="true" />
            <TaskIdentity task={task} />
            {isInspected && !isNow
              ? <span className={smartStyles.inspectFlag}>INSPECTING {task.time}</span>
              : null}
            {task.unlock ? <UnlockBranch label={task.unlock} /> : null}
          </article>
        );
      })}
    </div>
  );
}

function SmartRailDaySurface() {
  const [view, setView] = useState<DayView>("clock");
  const [inspectedIndex, setInspectedIndex] = useState(NOW_TASK_INDEX);

  return (
    <section
      className={`${styles.daySurface} ${smartStyles.boundedDaySurface}`}
      data-view={view}
      aria-label="Atlas Clock-first day with secondary ordered task rail fixture"
    >
      <DayHeader view={view} onChange={setView} />
      <DayNavigation position="top" />
      <DaySummaryPanel />
      {view === "clock"
        ? <CalendarClockView inspectedIndex={inspectedIndex} onInspect={setInspectedIndex} />
        : <OrderedTaskRail inspectedIndex={inspectedIndex} />}
      <DayNavigation position="bottom" />
    </section>
  );
}

function Study({ label, note, children }: { label: string; note: string; children: ReactNode }) {
  return (
    <section className={styles.study}>
      <header className={styles.studyLabel}><strong>{label}</strong><span>{note}</span></header>
      <Phone>{children}</Phone>
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
        <span>CLOCK + DAYBOOK STUDY 13 · BOUNDED FOCUS + CONTEXT</span>
        <h2 id="active-outcome-studies-heading">Clock stays bounded. Only its scrubber moves.</h2>
        <p>The screen keeps its Atlas header, day context, and footer in place. Below Return to now, the Clock becomes one bounded focus-and-context instrument: the first and last tasks remain represented, while the inspected region receives more room and detail. Initial focus is NOW; scrolling inside Clock moves the lens without turning inspection into current-time truth.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>This study is fixture-only. The focus lens changes visual allocation only. It never changes governed Clock time, task order, duration, completion, or placement. The approach borrows Chronicle&apos;s bounded-stage and zoom-detail discipline: context remains present while focus earns more visual resolution.</span>
      </div>
      <div className={styles.singleGallery}>
        <Study
          label="A · Bounded Clock scrubber + alternate Day rail"
          note="Return to now is the fixed top edge of the scrubber. Scroll, swipe, or use arrow keys inside Clock to move the focus lens. Every scheduled task stays represented from first through last; NOW alone stays purple."
        >
          <SmartRailDaySurface />
        </Study>
      </div>
    </section>
  );
}
