"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

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
const NOW_LABEL = "4:06 PM";
const SLIPPED_OUTCOME_TASK = TASKS[2];
const DAY_START_MINUTE = 7 * 60;
const DAY_END_MINUTE = 20 * 60;

// Fixture-only geometry for the compact smart rail. Production derives all
// three layers independently from governed Clock and result truth.
const SMART_PROGRESS_FRONTIER = 43;
const CURRENT_TIME_POSITION = 69;
const DAY_TASK_POSITIONS = [6, 13, 21, 29, 38, 47, 55, 64, 72, 84, 94];

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${hours}h ${remainder}m`;
  if (hours) return `${hours}h`;
  return `${remainder}m`;
}

function taskEnd(task: TaskDatum) {
  return task.minuteOfDay + task.durationMinutes;
}

function gapBefore(index: number) {
  const previousEnd = index === 0 ? DAY_START_MINUTE : taskEnd(TASKS[index - 1]);
  return Math.max(0, TASKS[index].minuteOfDay - previousEnd);
}

function elasticGapHeight(minutes: number) {
  if (minutes <= 0) return 0;
  return Math.min(58, Math.max(16, 11 + Math.sqrt(minutes) * 3.3));
}

function elasticTaskHeight(minutes: number) {
  return Math.min(76, Math.max(48, 38 + Math.log1p(minutes) * 7));
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
    <div className={styles.phone}>
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

function ElasticGap({ minutes }: { minutes: number }) {
  if (minutes <= 0) return null;
  return (
    <div className={smartStyles.elasticGap} style={{ height: `${elasticGapHeight(minutes)}px` }} aria-label={`${formatMinutes(minutes)} open between scheduled tasks`}>
      <span>{formatMinutes(minutes)}</span>
      <i aria-hidden="true" />
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
  const taskRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function settleOn(index: number, behavior: ScrollBehavior = "smooth") {
    const bounded = Math.max(0, Math.min(TASKS.length - 1, index));
    onInspect(bounded);
    taskRefs.current[bounded]?.scrollIntoView({ behavior, block: "center" });
  }

  useEffect(() => {
    let frame = 0;
    const observePageScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const viewportCenter = window.innerHeight / 2;
        let closestIndex = inspectedIndex;
        let closestDistance = Number.POSITIVE_INFINITY;

        taskRefs.current.forEach((node, index) => {
          if (!node) return;
          const rect = node.getBoundingClientRect();
          const center = rect.top + rect.height / 2;
          const distance = Math.abs(center - viewportCenter);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
          }
        });

        if (closestIndex !== inspectedIndex) onInspect(closestIndex);
      });
    };

    window.addEventListener("scroll", observePageScroll, { passive: true });
    observePageScroll();
    return () => {
      window.removeEventListener("scroll", observePageScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [inspectedIndex, onInspect]);

  const inspectingNow = inspectedIndex === NOW_TASK_INDEX;

  return (
    <section className={smartStyles.clockView} aria-label="Page-scrolling elastic day-timer Clock fixture">
      <header className={smartStyles.clockViewHeader}>
        <div>
          <span>DAY TIMER</span>
          <strong>{inspectingNow ? `NOW · ${NOW_LABEL}` : `INSPECTING · ${TASKS[inspectedIndex].time}`}</strong>
        </div>
        {!inspectingNow
          ? <button type="button" onClick={() => settleOn(NOW_TASK_INDEX)}>Return to now</button>
          : null}
      </header>

      <div className={smartStyles.clockDayBoundary}><span>7:00 AM</span><strong>DAY START</strong></div>
      <div className={smartStyles.calendarFlow} aria-label="Compressed calendar-shaped task chronology; the page itself owns vertical scrolling">
        {TASKS.map((task, index) => {
          const isNow = index === NOW_TASK_INDEX;
          const isInspected = index === inspectedIndex;
          return (
            <div className={smartStyles.calendarSequence} key={`${task.time}-${task.title}`}>
              <ElasticGap minutes={gapBefore(index)} />
              {isNow ? (
                <div className={smartStyles.calendarNow} aria-label={`Actual now ${NOW_LABEL}`}>
                  <span>{NOW_LABEL}</span><i aria-hidden="true" />
                </div>
              ) : null}
              <button
                ref={(node) => { taskRefs.current[index] = node; }}
                className={smartStyles.calendarTaskBlock}
                data-inspected={isInspected ? "true" : "false"}
                data-now={isNow ? "true" : "false"}
                data-placement-source={task.placementSource}
                type="button"
                style={{ minHeight: `${elasticTaskHeight(task.durationMinutes)}px` }}
                onClick={() => settleOn(index)}
                aria-label={`Inspect ${task.time}, ${task.family}, ${task.title}`}
              >
                <span>{task.time} · {task.family}</span>
                <strong>{task.title}</strong>
                {(isInspected || isNow) ? <small>{task.place} · {task.amount}</small> : null}
              </button>
            </div>
          );
        })}
        <ElasticGap minutes={Math.max(0, DAY_END_MINUTE - taskEnd(TASKS[TASKS.length - 1]))} />
      </div>
      <div className={smartStyles.clockDayBoundary}><span>8:00 PM</span><strong>DAY END</strong></div>
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
    <section className={styles.daySurface} aria-label="Atlas Clock-first day with secondary ordered task rail fixture">
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
        <span>CLOCK + DAYBOOK STUDY 12 · ONE PAGE SCROLL</span>
        <h2 id="active-outcome-studies-heading">Clock owns the schedule, but the page owns the scroll.</h2>
        <p>Clock remains the default worker-day viewer, but it is no longer a scrollable box inside Atlas. The ordinary page scroll drives temporal inspection. Only the real NOW task receives purple; inspecting another time enlarges a neutral task. Long empty stretches are elastically compressed instead of consuming the worker&apos;s screen.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>This study is fixture-only. Atlas-fit times demonstrate the approved scheduling responsibility: once work is admitted to the worker day, Clock must place it or raise a planning conflict. The elastic visual scale changes display distance only; it never changes the governed Clock time printed on a task.</span>
      </div>
      <div className={styles.singleGallery}>
        <Study
          label="A · Real-Atlas Clock + alternate Day rail"
          note="The date header owns the Clock/Day toggle. Smart progress has no duplicate finished count or window countdown. The unlock consequence is explicit and allowed to wrap. Clock is a compressed calendar-shaped page, not a nested scrolling calendar."
        >
          <SmartRailDaySurface />
        </Study>
      </div>
    </section>
  );
}
