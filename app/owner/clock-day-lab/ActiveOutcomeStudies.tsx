"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

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
const NOW_MINUTE = 16 * 60 + 6;
const NOW_LABEL = "4:06 PM";
const SLIPPED_OUTCOME_TASK = TASKS[2];

const CALENDAR_START_MINUTE = 7 * 60;
const CALENDAR_END_MINUTE = 20 * 60;
const CALENDAR_PX_PER_MINUTE = 0.92;
const CALENDAR_CANVAS_HEIGHT = (CALENDAR_END_MINUTE - CALENDAR_START_MINUTE) * CALENDAR_PX_PER_MINUTE + 72;
const CALENDAR_HOURS = Array.from(
  { length: (CALENDAR_END_MINUTE - CALENDAR_START_MINUTE) / 60 + 1 },
  (_, index) => CALENDAR_START_MINUTE / 60 + index,
);

// Fixture-only geometry for the compact smart rail. The task-placement dots are
// intentionally denser than the named specimen tasks shown in the study.
const SMART_PROGRESS_FRONTIER = 43;
const CURRENT_TIME_POSITION = 69;
const DAY_TASK_POSITIONS = [6, 13, 21, 29, 38, 47, 55, 64, 72, 84, 94];

function calendarY(minuteOfDay: number) {
  return (minuteOfDay - CALENDAR_START_MINUTE) * CALENDAR_PX_PER_MINUTE;
}

function taskBlockHeight(task: TaskDatum) {
  return Math.max(32, task.durationMinutes * CALENDAR_PX_PER_MINUTE);
}

function AppHeader() {
  return (
    <header className={styles.appHeader}>
      <div><span>ATLAS</span><strong>Elm Farm</strong></div>
      <span>clear · 93°</span>
      <button type="button" disabled aria-label="Fixture add">+</button>
    </header>
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
    <div
      className={smartStyles.consequenceRow}
      aria-label="Most consequential unresolved task fixture"
    >
      <span className={smartStyles.consequencePill}>MISSED WINDOW</span>
      <div className={smartStyles.consequenceCopy}>
        <strong>{SLIPPED_OUTCOME_TASK.family} · {SLIPPED_OUTCOME_TASK.title} still open</strong>
        <small>Holding {SLIPPED_OUTCOME_TASK.unlock}</small>
      </div>
      <span className={smartStyles.consequenceCaret} aria-hidden="true">⌄</span>
    </div>
  );
}

function DaySummaryPanel() {
  return (
    <section className={smartStyles.daySummaryPanel} aria-label="Atlas day summary fixture">
      <div className={smartStyles.daySummaryTop}>
        <strong>6 OF 11 FINISHED</strong>
        <div className={smartStyles.dayWindow}><span>WINDOW</span><b>00:18</b></div>
      </div>
      <SmartDayRail />
      <div className={smartStyles.daySummaryDivider} aria-hidden="true" />
      <ConsequenceRow />
    </section>
  );
}

function DayHeader() {
  return (
    <section className={styles.dayHeader}>
      <div className={styles.dayHeaderTop}>
        <div className={styles.dayIdentity}>
          <span>WEDNESDAY</span>
          <strong>Aug 26</strong>
        </div>
        <div className={styles.dayCount}><strong>11</strong><span>tasks</span><small>6 done</small></div>
      </div>
    </section>
  );
}

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className={styles.phone}>
      <AppHeader />
      <DayHeader />
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

function ViewToggle({ view, onChange }: { view: DayView; onChange: (view: DayView) => void }) {
  return (
    <div className={smartStyles.viewToggle} role="group" aria-label="Clock or day task-feed view">
      <button type="button" data-active={view === "clock" ? "true" : "false"} onClick={() => onChange("clock")}>Clock</button>
      <button type="button" data-active={view === "day" ? "true" : "false"} onClick={() => onChange("day")}>Day</button>
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
  const viewportRef = useRef<HTMLDivElement>(null);

  function settleOn(index: number, behavior: ScrollBehavior = "smooth") {
    const bounded = Math.max(0, Math.min(TASKS.length - 1, index));
    const viewport = viewportRef.current;
    onInspect(bounded);
    if (!viewport) return;
    const task = TASKS[bounded];
    const focusY = calendarY(task.minuteOfDay) + taskBlockHeight(task) / 2;
    viewport.scrollTo({
      top: Math.max(0, focusY - viewport.clientHeight / 2),
      behavior,
    });
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => settleOn(NOW_TASK_INDEX, "auto"));
    return () => window.cancelAnimationFrame(frame);
    // This fixture deliberately opens the Clock centered on actual NOW.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const focusY = viewport.scrollTop + viewport.clientHeight / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    TASKS.forEach((task, index) => {
      const centerY = calendarY(task.minuteOfDay) + taskBlockHeight(task) / 2;
      const distance = Math.abs(centerY - focusY);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    if (closestIndex !== inspectedIndex) onInspect(closestIndex);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      settleOn(inspectedIndex - 1);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      settleOn(inspectedIndex + 1);
    }
  }

  const inspectingNow = inspectedIndex === NOW_TASK_INDEX;

  return (
    <section className={smartStyles.clockView} aria-label="Scrollable day-timer Clock fixture">
      <header className={smartStyles.clockViewHeader}>
        <div><span>DAY TIMER</span><strong>{inspectingNow ? `NOW · ${NOW_LABEL}` : `INSPECTING · ${TASKS[inspectedIndex].time}`}</strong></div>
        {!inspectingNow
          ? <button type="button" onClick={() => settleOn(NOW_TASK_INDEX)}>Return to now</button>
          : null}
      </header>
      <div
        className={smartStyles.calendarViewport}
        ref={viewportRef}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-label="Scroll vertically through the scheduled day. The task nearest the center is inspected; the NOW line remains factual."
      >
        <div className={smartStyles.calendarCanvas} style={{ height: `${CALENDAR_CANVAS_HEIGHT}px` }}>
          {CALENDAR_HOURS.map((hour) => (
            <div className={smartStyles.calendarHour} style={{ top: `${calendarY(hour * 60)}px` }} key={hour}>
              <span>{hour === 12 ? "12 PM" : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}</span>
              <i aria-hidden="true" />
            </div>
          ))}

          <div className={smartStyles.calendarNow} style={{ top: `${calendarY(NOW_MINUTE)}px` }} aria-label={`Actual now ${NOW_LABEL}`}>
            <span>{NOW_LABEL}</span><i aria-hidden="true" />
          </div>

          {TASKS.map((task, index) => {
            const inspected = index === inspectedIndex;
            return (
              <button
                className={smartStyles.calendarTaskBlock}
                data-inspected={inspected ? "true" : "false"}
                data-now={index === NOW_TASK_INDEX ? "true" : "false"}
                data-placement-source={task.placementSource}
                type="button"
                style={{
                  top: `${calendarY(task.minuteOfDay)}px`,
                  height: `${taskBlockHeight(task)}px`,
                }}
                key={`${task.time}-${task.title}`}
                onClick={() => settleOn(index)}
                aria-label={`Inspect ${task.time}, ${task.family}, ${task.title}`}
              >
                <span>{task.time} · {task.family}</span>
                <strong>{task.title}</strong>
                {inspected ? <small>{task.place} · {task.amount}</small> : null}
              </button>
            );
          })}
        </div>
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
        return (
          <article
            className={`${styles.cleanNode} ${isInspected ? smartStyles.feedInspected : ""}`}
            data-active={isNow ? "true" : "false"}
            data-inspected={isInspected ? "true" : "false"}
            key={task.title}
          >
            <i className={styles.railDot} aria-hidden="true" />
            <TaskIdentity task={task} />
            {isInspected && inspectedIndex !== NOW_TASK_INDEX
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
    <section className={styles.daySurface} aria-label="Atlas day summary with Clock-first scheduler view and secondary day task feed fixture">
      <DaySummaryPanel />
      <ViewToggle view={view} onChange={setView} />
      {view === "clock"
        ? <CalendarClockView inspectedIndex={inspectedIndex} onInspect={setInspectedIndex} />
        : <OrderedTaskRail inspectedIndex={inspectedIndex} />}
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
        <span>CLOCK + DAYBOOK STUDY 11 · CLOCK-FIRST DAY TIMER</span>
        <h2 id="active-outcome-studies-heading">Clock schedules the day. Day shows the whole work rail.</h2>
        <p>The default view is now a deliberately plain, Google-Calendar-like day timer with the scrubber behavior built into the vertical time axis. Every executable task shown to the worker has a Clock placement, including work Atlas had to fit into the day. The Day toggle keeps the full rail as the secondary detailed list.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>This study is still fixture-only. It tests the product contract that Clock is allowed to place flexible work into the worker day rather than leaving it in an unplanned pocket. Production must derive and commit those placements through governed Clock choreography; this mockup does not write schedule truth.</span>
      </div>
      <div className={styles.singleGallery}>
        <Study
          label="A · Clock-first calendar scrubber + Day rail toggle"
          note="The calendar is intentionally plain for this pass: proportional time, scheduled blocks, factual NOW line, vertical scrub inspection, and a secondary Day list. Fancy watch-face distortion can come later if this geometry is clear."
        >
          <SmartRailDaySurface />
        </Study>
      </div>
    </section>
  );
}
