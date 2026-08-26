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
  unlock?: string;
};

const TASKS: TaskDatum[] = [
  {
    family: "STEWARDSHIP",
    title: "Farm Round · Elm Farm",
    place: "Elm Farm",
    amount: "Farm Round",
    time: "8:00 AM",
  },
  {
    family: "WEED",
    title: "MG11",
    place: "Main Garden",
    amount: "30 min · Heavy",
    time: "10:15 AM",
  },
  {
    family: "TIDY",
    title: "Farmhouse",
    place: "Interior",
    amount: "20 min · Standard",
    time: "1:30 PM",
    unlock: "Thursday Ticketed Night · Aug 27",
  },
  {
    family: "POT UP",
    title: "Sweet William",
    place: "Grow Room",
    amount: "3 trays · 600 plants",
    time: "4:06 PM",
    unlock: "Harvest Stems · May 6",
  },
  {
    family: "SPRAY",
    title: "BB10 · Bermuda Pass 1",
    place: "Barn Beds",
    amount: "20 min · Pass 1 of 3",
    time: "7:00 PM",
    unlock: "Choose Overwintering Crop · Sep 15",
  },
];

const NOW_TASK_INDEX = 3;
const SLIPPED_OUTCOME_TASK = TASKS[2];
const SCRUBBER_ROW_HEIGHT = 32;

// Fixture-only geometry for the single smart rail. Production must derive all
// three layers independently from governed Clock placement/result truth.
const SMART_PROGRESS_FRONTIER = 43;
const CURRENT_TIME_POSITION = 69;
const DAY_TASK_POSITIONS = [6, 13, 21, 29, 38, 47, 55, 64, 72, 84, 94];

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
      >4:06 PM</small>
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
        <span>Home</span><strong>Clock</strong><span>Manager</span><span>Harvest</span><span>More</span>
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

function ScrollableDayIndex({
  inspectedIndex,
  onInspect,
}: {
  inspectedIndex: number;
  onInspect: (index: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = inspectedIndex * SCRUBBER_ROW_HEIGHT;
  }, []); // initialize the fixture on the actual NOW task only once

  function settleOn(index: number) {
    const bounded = Math.max(0, Math.min(TASKS.length - 1, index));
    onInspect(bounded);
    viewportRef.current?.scrollTo({
      top: bounded * SCRUBBER_ROW_HEIGHT,
      behavior: "smooth",
    });
  }

  function handleScroll() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const index = Math.max(
      0,
      Math.min(TASKS.length - 1, Math.round(viewport.scrollTop / SCRUBBER_ROW_HEIGHT)),
    );
    if (index !== inspectedIndex) onInspect(index);
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

  return (
    <section className={smartStyles.scrubberStudy} aria-label="Provisional scrollable day index fixture">
      <div className={smartStyles.scrubberCaption}>
        <span>SCROLL DAY</span>
        <small>{inspectedIndex === NOW_TASK_INDEX ? "NOW" : "INSPECTING"}</small>
      </div>
      <div className={smartStyles.scrubberShell}>
        <div
          className={smartStyles.scrubberViewport}
          ref={viewportRef}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          aria-label="Scroll up and down through placed tasks. The centered task is inspected; actual NOW remains 4:06 PM on the day rail."
        >
          <div className={smartStyles.scrubberSpacer} aria-hidden="true" />
          {TASKS.map((task, index) => (
            <button
              className={smartStyles.scrubberRow}
              data-inspected={index === inspectedIndex ? "true" : "false"}
              type="button"
              key={`${task.time}-${task.title}`}
              onClick={() => settleOn(index)}
              aria-label={`Inspect ${task.time}, ${task.family}, ${task.title}`}
            >
              <span>{task.time}</span>
              <small>{task.family}</small>
              <strong>{task.title}</strong>
            </button>
          ))}
          <div className={smartStyles.scrubberSpacer} aria-hidden="true" />
        </div>
        <i className={smartStyles.scrubberSelection} aria-hidden="true" />
        <i className={smartStyles.scrubberFadeTop} aria-hidden="true" />
        <i className={smartStyles.scrubberFadeBottom} aria-hidden="true" />
      </div>
    </section>
  );
}

function OrderedTaskRail({ inspectedIndex }: { inspectedIndex: number }) {
  return (
    <div className={styles.cleanRail} aria-label="Ordered task rail fixture synchronized to the scrollable day index">
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
  const [inspectedIndex, setInspectedIndex] = useState(NOW_TASK_INDEX);

  return (
    <section className={styles.daySurface} aria-label="Atlas-style day summary, scrollable time index, and synchronized ordered task feed fixture">
      <DaySummaryPanel />
      <ScrollableDayIndex inspectedIndex={inspectedIndex} onInspect={setInspectedIndex} />
      <OrderedTaskRail inspectedIndex={inspectedIndex} />
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
        <span>CLOCK + DAYBOOK STUDY 10 · TEMPORAL SCRUBBER</span>
        <h2 id="active-outcome-studies-heading">The roller becomes a time index. The feed remains the work.</h2>
        <p>The Atlas-style purple day summary now owns smart progress and consequence state. Below it, the provisional roller is a vertical snap scrubber: scroll through time to inspect placed tasks while the full task feed highlights the same task. Actual NOW never moves when inspection moves.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>The scrubber location is intentionally provisional. Its interaction contract is the study: scroll up or down, snap to one real placed task, and synchronize inspection identity with the full feed without changing current time, Clock placement, task state, or the 43% Day Clearance Frontier. All times and tasks remain editor fixtures.</span>
      </div>
      <div className={styles.singleGallery}>
        <Study
          label="A · Atlas day summary + scrollable temporal index"
          note="The purple card stays close to current Atlas. The roller earns its place only as a compressed time-navigation surface: it lets you inspect chronology while the regular feed remains the detailed work surface."
        >
          <SmartRailDaySurface />
        </Study>
      </div>
    </section>
  );
}
