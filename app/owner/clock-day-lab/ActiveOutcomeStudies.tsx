import styles from "./active-outcome-studies.module.css";

type TaskDatum = {
  family: string;
  title: string;
  place: string;
  amount: string;
  window: string;
  clock: string;
  unlock?: string;
};

const TASKS: TaskDatum[] = [
  {
    family: "STEWARDSHIP",
    title: "Farm Round · Elm Farm",
    place: "Elm Farm",
    amount: "Farm Round",
    window: "Morning",
    clock: "7:00",
  },
  {
    family: "WEED",
    title: "MG11",
    place: "Main Garden",
    amount: "30 min · Heavy",
    window: "Morning",
    clock: "8:30",
  },
  {
    family: "POT UP",
    title: "Sweet William",
    place: "Grow Room",
    amount: "3 trays · 600 plants",
    window: "Midafternoon",
    clock: "2:30",
    unlock: "Harvest Stems · May 6",
  },
  {
    family: "SPRAY",
    title: "BB10 · Bermuda Pass 1",
    place: "Barn Beds",
    amount: "20 min · Pass 1 of 3",
    window: "Evening",
    clock: "7:00",
    unlock: "Choose Overwintering Crop · Sep 15",
  },
];

const ACTIVE_TASK = TASKS[2];
const HOURS = ["7 AM", "9 AM", "11 AM", "1 PM", "3 PM", "5 PM", "7 PM"] as const;

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

function Phone({ children }: { children: React.ReactNode }) {
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

function MovingNowNode() {
  return (
    <section className={styles.movingSurface} aria-label="Moving NOW node merged clock and task feed fixture">
      <div className={styles.overdueLine}><strong>2 overdue</strong><span>1 connected to the current move</span></div>
      <div className={styles.movingRail}>
        {TASKS.map((task) => {
          const active = task === ACTIVE_TASK;
          return (
            <article className={styles.movingNode} data-active={active ? "true" : "false"} key={task.title}>
              <div className={styles.nodeWhen}><strong>{task.window}</strong><span>{task.clock}</span></div>
              <i className={styles.railDot} aria-hidden="true" />
              {active ? <div className={styles.nowCrossing}><span>3:06 PM</span></div> : null}
              <TaskIdentity task={task} />
              {task.unlock ? <UnlockBranch label={task.unlock} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ClockSpine() {
  return (
    <section className={styles.clockSurface} aria-label="Clock spine merged clock and task feed fixture">
      <div className={styles.clockScale}>
        {HOURS.map((hour) => <span key={hour}>{hour}</span>)}
      </div>
      <div className={styles.clockSpine}>
        {HOURS.map((hour) => <i className={styles.hourTick} key={hour} />)}
        <div className={styles.spineTask} data-kind="round" style={{ top: "4%" }}>
          <i className={styles.railDot} aria-hidden="true" />
          <TaskIdentity task={TASKS[0]} />
        </div>
        <div className={styles.spineTask} data-kind="weed" style={{ top: "17%" }}>
          <i className={styles.railDot} aria-hidden="true" />
          <TaskIdentity task={TASKS[1]} />
        </div>
        <div className={styles.spineTask} data-active="true" style={{ top: "58%" }}>
          <i className={styles.railDot} aria-hidden="true" />
          <TaskIdentity task={TASKS[2]} />
          <UnlockBranch label="Harvest Stems · May 6" />
        </div>
        <div className={styles.spineTask} data-kind="spray" style={{ top: "87%" }}>
          <i className={styles.railDot} aria-hidden="true" />
          <TaskIdentity task={TASKS[3]} />
          <UnlockBranch label="Choose Overwintering Crop · Sep 15" />
        </div>
        <div className={styles.spineNow} style={{ top: "61%" }}><span>3:06 PM</span></div>
      </div>
    </section>
  );
}

function Study({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
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
        <span>CLOCK + DAYBOOK STUDY 4 · ONE SURFACE</span>
        <h2 id="active-outcome-studies-heading">The rail is the clock.</h2>
        <p>Two merged-surface studies. No Timeline / Daybook toggle and no calendar cards. Tasks, time, NOW, and downstream unlocks all live on one chronological rail.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>Sweet William is the real open 3-tray / 600-plant pot-up task. Its crop profile carries a May 1–June 30, 2027 harvest-watch window. “Harvest Stems · May 6” remains the owner-requested design fixture date, not a materialized production harvest task.</span>
      </div>
      <div className={styles.gallery}>
        <Study
          label="A · Moving NOW node"
          note="Task-feed density with a single rail. The current-time rule crosses the rail exactly at the task Atlas says should be active."
        >
          <MovingNowNode />
        </Study>
        <Study
          label="B · Clock spine"
          note="A sparse real-time scale becomes the rail itself. Tasks are nodes attached to the clock instead of boxes occupying calendar blocks."
        >
          <ClockSpine />
        </Study>
      </div>
    </section>
  );
}
