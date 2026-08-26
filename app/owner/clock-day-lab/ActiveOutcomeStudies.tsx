import type { ReactNode } from "react";

import styles from "./active-outcome-studies.module.css";
import smartStyles from "./smart-day-study.module.css";

type TaskDatum = {
  family: string;
  title: string;
  place: string;
  amount: string;
  unlock?: string;
};

const TASKS: TaskDatum[] = [
  {
    family: "STEWARDSHIP",
    title: "Farm Round · Elm Farm",
    place: "Elm Farm",
    amount: "Farm Round",
  },
  {
    family: "WEED",
    title: "MG11",
    place: "Main Garden",
    amount: "30 min · Heavy",
  },
  {
    family: "TIDY",
    title: "Farmhouse",
    place: "Interior",
    amount: "20 min · Standard",
    unlock: "Thursday Ticketed Night · Aug 27",
  },
  {
    family: "POT UP",
    title: "Sweet William",
    place: "Grow Room",
    amount: "3 trays · 600 plants",
    unlock: "Harvest Stems · May 6",
  },
  {
    family: "SPRAY",
    title: "BB10 · Bermuda Pass 1",
    place: "Barn Beds",
    amount: "20 min · Pass 1 of 3",
    unlock: "Choose Overwintering Crop · Sep 15",
  },
];

const ACTIVE_TASK = TASKS[3];
const SLIPPED_OUTCOME_TASK = TASKS[2];

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

function DayInstrument() {
  return (
    <div className={styles.dayInstrument} aria-label="One smart rail plus current work-window countdown fixture">
      <div className={styles.dayDone}><strong>6 / 11</strong><span>done</span></div>
      <SmartDayRail />
      <div className={styles.dayWindow}><span>WINDOW</span><strong>00:18</strong></div>
    </div>
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
      <DayInstrument />
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

function CurrentMoveRoller() {
  return (
    <div className={styles.timeDeck} aria-label="Unboxed rolling current scheduled move fixture">
      <div className={styles.rollerViewport}>
        <div className={styles.rollerFadeTop} aria-hidden="true" />
        <div className={styles.rollerRow} data-position="previous">
          <span>3:30 PM</span><small>WEED</small><strong>MG11</strong>
        </div>
        <div className={styles.rollerSelection} aria-hidden="true" />
        <div className={styles.rollerRow} data-position="current">
          <span>4:06 PM</span><small>POT UP</small><strong>Sweet William</strong>
        </div>
        <div className={styles.rollerRow} data-position="next">
          <span>7:00 PM</span><small>SPRAY</small><strong>BB10 · Bermuda Pass 1</strong>
        </div>
        <div className={styles.rollerFadeBottom} aria-hidden="true" />
      </div>
    </div>
  );
}

function ConsequenceStrip() {
  return (
    <section
      className={smartStyles.consequenceStrip}
      aria-label="Most consequential unresolved task fixture"
    >
      <span className={smartStyles.consequencePill}>MISSED WINDOW</span>
      <div className={smartStyles.consequenceCopy}>
        <strong>{SLIPPED_OUTCOME_TASK.family} · {SLIPPED_OUTCOME_TASK.title} still open</strong>
        <small>Holding {SLIPPED_OUTCOME_TASK.unlock}</small>
      </div>
      <span className={smartStyles.consequenceCaret} aria-hidden="true">⌄</span>
    </section>
  );
}

function OrderedTaskRail() {
  return (
    <div className={styles.cleanRail} aria-label="Ordered task rail fixture">
      {TASKS.map((task) => {
        const active = task === ACTIVE_TASK;
        return (
          <article
            className={styles.cleanNode}
            data-active={active ? "true" : "false"}
            key={task.title}
          >
            <i className={styles.railDot} aria-hidden="true" />
            <TaskIdentity task={task} />
            {task.unlock ? <UnlockBranch label={task.unlock} /> : null}
          </article>
        );
      })}
    </div>
  );
}

function SmartRailDaySurface() {
  return (
    <section className={styles.daySurface} aria-label="Smart day rail, rolling NOW task, compact consequence strip, and ordered task rail fixture">
      <CurrentMoveRoller />
      <ConsequenceStrip />
      <OrderedTaskRail />
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
        <span>CLOCK + DAYBOOK STUDY 9 · SMART DAY RAIL</span>
        <h2 id="active-outcome-studies-heading">One rail carries work progress, time, and where Atlas placed the day.</h2>
        <p>The same horizontal rail now carries the earned chronological progress fill, the current-time marker, and faint task-placement dots. Below the NOW roller, consequential unfinished work returns to Atlas&apos;s compact carried-move grammar instead of living in a second scorecard.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>The 43% progress frontier intentionally trails the 4:06 PM current-time marker even though 6 of 11 tasks are marked done. It demonstrates the production rule that later completed work cannot erase unresolved earlier work. All task-dot positions, times, and consequence labels remain editor fixtures.</span>
      </div>
      <div className={styles.singleGallery}>
        <Study
          label="A · Smart single rail + Atlas-style consequence row"
          note="Purple fill means earned chronological clearance, the larger ring means NOW, and faint dots show the distribution of Clock-placed work. The compact row surfaces the highest-consequence unresolved task without duplicating the day score."
        >
          <SmartRailDaySurface />
        </Study>
      </div>
    </section>
  );
}
