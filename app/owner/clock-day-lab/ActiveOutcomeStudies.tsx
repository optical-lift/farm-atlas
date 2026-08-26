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
      <div className={styles.dayCount}><strong>11</strong><span>tasks</span><small>6 done</small></div>
      <div className={styles.dayProgress}>
        <span>6 of 11 finished</span>
        <i aria-hidden="true"><b /></i>
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

function CurrentMoveScorecard() {
  return (
    <section className={styles.scorecard} aria-label="Current move scorecard fixture">
      <div className={styles.scoreTopline}>
        <div><span>TODAY</span><strong>11 tasks · 6 done</strong></div>
        <div className={styles.windowClock}><span>WINDOW</span><strong>00:33</strong></div>
      </div>

      <div className={styles.currentMove}>
        <span>CURRENT MOVE</span>
        <strong>Pot up Sweet William</strong>
        <div className={styles.currentUnlock}><span>UNLOCKS</span><b>Harvest Stems · May 6</b></div>
      </div>

      <div className={styles.timeBar} aria-label="Fixture workday from 7 AM to 8 PM with current time at 3:27 PM">
        <span>7 AM</span>
        <div className={styles.timeTrack} aria-hidden="true">
          <i className={styles.elapsedTime} />
          <b className={styles.currentTimeDot} />
        </div>
        <span>8 PM</span>
      </div>
      <div className={styles.currentTimeLabel}>3:27 PM</div>
    </section>
  );
}

function CountdownRail() {
  return (
    <section className={styles.countdownSurface} aria-label="Countdown scorecard with clean task rail fixture">
      <CurrentMoveScorecard />
      <div className={styles.cleanRail}>
        {TASKS.map((task, index) => {
          const active = task === ACTIVE_TASK;
          const passed = index < 2;
          return (
            <article
              className={styles.cleanNode}
              data-active={active ? "true" : "false"}
              data-passed={passed ? "true" : "false"}
              key={task.title}
            >
              <i className={styles.railDot} aria-hidden="true" />
              <TaskIdentity task={task} />
              {task.unlock ? <UnlockBranch label={task.unlock} /> : null}
            </article>
          );
        })}
      </div>
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
        <span>CLOCK + DAYBOOK STUDY 5 · COUNTDOWN SCORECARD</span>
        <h2 id="active-outcome-studies-heading">Time lives at the top. Work lives on the rail.</h2>
        <p>The schedule column is gone. One compact scorecard carries day progress, the current move, its real downstream unlock, and a living countdown. The feed below stays a clean line-and-dot causal rail.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>Sweet William is the real open 3-tray / 600-plant pot-up task. Its crop profile carries a May 1–June 30, 2027 harvest-watch window. “Harvest Stems · May 6” and the 00:33 countdown are design fixtures for the editor, not materialized production timing.</span>
      </div>
      <div className={styles.singleGallery}>
        <Study
          label="A · Living countdown + clean rail"
          note="The top scorecard owns the clock. The task feed no longer repeats Morning / Midafternoon / exact-time labels beside every node."
        >
          <CountdownRail />
        </Study>
      </div>
    </section>
  );
}
