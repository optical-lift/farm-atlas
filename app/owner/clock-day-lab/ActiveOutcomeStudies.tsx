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

function AppHeader() {
  return (
    <header className={styles.appHeader}>
      <div><span>ATLAS</span><strong>Elm Farm</strong></div>
      <span>clear · 93°</span>
      <button type="button" disabled aria-label="Fixture add">+</button>
    </header>
  );
}

function DayInstrument() {
  return (
    <div className={styles.dayInstrument} aria-label="Merged day progress and current window instrument fixture">
      <div className={styles.dayDone}><strong>6 / 11</strong><span>done</span></div>
      <div className={styles.dayClock}>
        <div className={styles.dayClockTrack} aria-hidden="true">
          <i className={styles.dayClockElapsed} />
          <b className={styles.dayClockDot} />
        </div>
        <small className={styles.dayClockNow}>4:06 PM</small>
      </div>
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

function OutcomeScorecard() {
  return (
    <section className={styles.outcomeBox} aria-label="Current move roller plus most consequential slipped task scorecard fixture">
      <CurrentMoveRoller />
      <div className={styles.scoreBody}>
        <div className={styles.scoreCount}>
          <strong>11</strong>
          <span>tasks</span>
          <small>6 done</small>
        </div>
        <div className={styles.scoreMove}>
          <span>{SLIPPED_OUTCOME_TASK.family}</span>
          <strong>{SLIPPED_OUTCOME_TASK.title}</strong>
          <div className={styles.scoreUnlock}><span>UNLOCKS</span><b>{SLIPPED_OUTCOME_TASK.unlock}</b></div>
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
    <section className={styles.daySurface} aria-label="Merged day instrument, rolling NOW task, slipped outcome score, and ordered task rail fixture">
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
        <span>CLOCK + DAYBOOK STUDY 8 · NOW VS CONSEQUENCE</span>
        <h2 id="active-outcome-studies-heading">The clock points forward. The scorecard remembers what slipped.</h2>
        <p>Day completion, current time, and the active work-window countdown share one compact instrument under the date. The NOW task then ticks through an unboxed hairline viewport, while the white score below independently carries the slipped task with the most important downstream unlock.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>Sweet William is the current-move design fixture. Tidy · Farmhouse → Thursday Ticketed Night · Aug 27 demonstrates the independent slipped-outcome selector. The rolling timestamps, 4:06 PM, 00:18, event date, and May 6 harvest label are editor fixtures rather than live task projections.</span>
      </div>
      <div className={styles.singleGallery}>
        <Study
          label="A · Forward clock + slipped consequence score"
          note="The shallow instrument under the date answers where the day is now. The unboxed hairline roller answers what should be happening now. The white score answers which already-missed move matters most."
        >
          <RollerScorecardDaySurface />
        </Study>
      </div>
    </section>
  );
}
