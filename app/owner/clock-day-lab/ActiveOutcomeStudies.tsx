import type { ReactNode } from "react";

import styles from "./active-outcome-studies.module.css";

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

const ACTIVE_TASK = TASKS[2];

function AppHeader() {
  return (
    <header className={styles.appHeader}>
      <div><span>ATLAS</span><strong>Elm Farm</strong></div>
      <span>clear · 93°</span>
      <button type="button" disabled aria-label="Fixture add">+</button>
    </header>
  );
}

function DayHeader() {
  return (
    <section className={styles.dayHeader}>
      <div className={styles.dayIdentity}>
        <span>WEDNESDAY</span>
        <strong>Aug 26</strong>
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

function TimeRollerDeck() {
  return (
    <div className={styles.timeDeck} aria-label="Rolling current-time viewport fixture">
      <div className={styles.dayMeter}>
        <span>6 / 11</span>
        <i aria-hidden="true"><b /></i>
      </div>
      <div className={styles.rollerViewport}>
        <div className={styles.rollerFadeTop} aria-hidden="true" />
        <div className={styles.rollerRow} data-position="previous">
          <span>3:24</span><strong>MG11</strong><small>WEED</small>
        </div>
        <div className={styles.rollerSelection} aria-hidden="true" />
        <div className={styles.rollerRow} data-position="current">
          <span>3:42 PM</span><strong>Sweet William</strong><small>00:18</small>
        </div>
        <div className={styles.rollerRow} data-position="next">
          <span>4:00</span><strong>BB10</strong><small>SPRAY</small>
        </div>
        <div className={styles.rollerFadeBottom} aria-hidden="true" />
      </div>
    </div>
  );
}

function OutcomeScorecard() {
  return (
    <section className={styles.outcomeBox} aria-label="Rolling time deck with current move and unlock scorecard fixture">
      <TimeRollerDeck />
      <div className={styles.scoreBody}>
        <div className={styles.scoreCount}>
          <strong>11</strong>
          <span>tasks</span>
          <small>6 done</small>
        </div>
        <div className={styles.scoreMove}>
          <span>POT UP</span>
          <strong>Sweet William</strong>
          <div className={styles.scoreUnlock}><span>UNLOCKS</span><b>Harvest Stems · May 6</b></div>
        </div>
      </div>
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

function RollerScorecardDaySurface() {
  return (
    <section className={styles.daySurface} aria-label="Rolling scorecard clock and ordered task rail fixture">
      <OutcomeScorecard />
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
        <span>CLOCK + DAYBOOK STUDY 7 · ROLLING SCORECARD CLOCK</span>
        <h2 id="active-outcome-studies-heading">Time rolls through the scorecard. Work stays on the rail.</h2>
        <p>The separate day-progress row and separate NOW sliver collapse into one pale-purple roller deck inside the existing scorecard footprint. The white score area gets shorter; the ordered task rail begins immediately below.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>Sweet William is the real open 3-tray / 600-plant pot-up task. Its crop profile carries a May 1–June 30, 2027 harvest-watch window. “Harvest Stems · May 6,” the rolling timestamps, and the 00:18 countdown are editor fixtures, not materialized production timing.</span>
      </div>
      <div className={styles.singleGallery}>
        <Study
          label="A · Rolling time deck inside the scorecard"
          note="The purple cap is a fixed viewport: earlier time drifts out above, the crisp center row is NOW, and the next work state waits below. The whole scorecard stays compact instead of stacking another clock card."
        >
          <RollerScorecardDaySurface />
        </Study>
      </div>
    </section>
  );
}
