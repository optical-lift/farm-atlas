import styles from "./active-outcome-studies.module.css";

type TaskDatum = {
  family: string;
  title: string;
  place: string;
  amount: string;
  window: string;
  date: string;
};

const TASKS: TaskDatum[] = [
  {
    family: "WEED",
    title: "MG11",
    place: "Main Garden",
    amount: "30 min · Heavy",
    window: "Morning",
    date: "Aug 24",
  },
  {
    family: "POT UP",
    title: "Sweet William",
    place: "Grow Room",
    amount: "3 trays · 600 plants",
    window: "Midafternoon",
    date: "Aug 24",
  },
  {
    family: "SPRAY",
    title: "BB10 · Bermuda Pass 1",
    place: "Barn Beds",
    amount: "20 min · Pass 1 of 3",
    window: "Evening",
    date: "Aug 26",
  },
];

const ACTIVE_TASK = TASKS[1];

const HARVEST_TARGET = {
  family: "HARVEST",
  title: "Harvest Stems",
  subject: "Sweet William",
  date: "Apr 2027",
  projection: "Exact first-cut date not modeled",
} as const;

function DayHeader() {
  return (
    <section className={styles.dayHeader}>
      <div>
        <span>WEDNESDAY</span>
        <strong>Aug 26</strong>
      </div>
      <div className={styles.dayProgress}>
        <span>6 of 11 finished</span>
        <i aria-hidden="true"><b /></i>
      </div>
    </section>
  );
}

function TaskRows({ active = "Sweet William" }: { active?: string }) {
  return (
    <section className={styles.taskList} aria-label="Standardized task row study">
      <header>
        <span>MIDAFTERNOON</span>
        <small>3 remaining</small>
      </header>
      {TASKS.map((task) => (
        <article className={styles.taskRow} data-active={task.title === active ? "true" : "false"} key={task.title}>
          <div className={styles.taskWhen}>
            <strong>{task.window}</strong>
            <span>{task.date}</span>
          </div>
          <div className={styles.taskIdentity}>
            <span>{task.family}</span>
            <strong>{task.title}</strong>
            <small>{task.place} · {task.amount}</small>
          </div>
        </article>
      ))}
    </section>
  );
}

function PhoneFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className={styles.study}>
      <div className={styles.studyLabel}>{label}</div>
      <div className={styles.phone}>
        <header className={styles.appHeader}>
          <div><span>ATLAS</span><strong>Elm Farm</strong></div>
          <span>clear · 92°</span>
          <button type="button" disabled aria-label="Fixture add">+</button>
        </header>
        <div className={styles.modeSwitch}><span>Timeline</span><strong>Daybook</strong></div>
        <DayHeader />
        {children}
        <TaskRows />
        <footer className={styles.nav}><span>Home</span><strong>Clock</strong><span>Manager</span><span>More</span></footer>
      </div>
    </section>
  );
}

function ClockToHarvest() {
  return (
    <PhoneFrame label="A · Clock → harvest">
      <section className={styles.nowPanel}>
        <div className={styles.nowClock}><span>1:53 PM</span><strong>NOW</strong></div>
        <div className={styles.nowTask}>
          <span>{ACTIVE_TASK.family}</span>
          <strong>{ACTIVE_TASK.title}</strong>
          <small>{ACTIVE_TASK.place} · {ACTIVE_TASK.amount}</small>
        </div>
        <div className={styles.harvestLink}>
          <span>{HARVEST_TARGET.family}</span>
          <strong>{HARVEST_TARGET.title} · {HARVEST_TARGET.subject}</strong>
          <b>{HARVEST_TARGET.date}</b>
          <small>{HARVEST_TARGET.projection}</small>
        </div>
      </section>
    </PhoneFrame>
  );
}

function CompactTargetStrip() {
  return (
    <PhoneFrame label="B · Active card + target strip">
      <section className={styles.activeCard}>
        <div className={styles.activeCardTop}>
          <span>1:53 PM · MIDAFTERNOON</span>
          <strong>ACTIVE</strong>
        </div>
        <div className={styles.activeCardTask}>
          <span>{ACTIVE_TASK.family}</span>
          <strong>{ACTIVE_TASK.title}</strong>
          <small>{ACTIVE_TASK.place} · {ACTIVE_TASK.amount}</small>
        </div>
        <div className={styles.targetStrip}>
          <span>{HARVEST_TARGET.family}</span>
          <strong>{HARVEST_TARGET.title}</strong>
          <b>{HARVEST_TARGET.subject}</b>
          <time>{HARVEST_TARGET.date}</time>
        </div>
      </section>
    </PhoneFrame>
  );
}

function HeaderLedger() {
  return (
    <PhoneFrame label="C · Day ledger">
      <section className={styles.ledger}>
        <div className={styles.ledgerNow}>
          <span>NOW · 1:53 PM</span>
          <strong>{ACTIVE_TASK.title}</strong>
          <small>{ACTIVE_TASK.family} · {ACTIVE_TASK.place}</small>
        </div>
        <div className={styles.ledgerRule} aria-hidden="true" />
        <div className={styles.ledgerFuture}>
          <span>FUTURE TASK</span>
          <strong>{HARVEST_TARGET.title}</strong>
          <small>{HARVEST_TARGET.subject}</small>
          <b>{HARVEST_TARGET.date}</b>
        </div>
      </section>
    </PhoneFrame>
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
        <span>DAYBOOK STUDY 2 · ACTIVE TASK + REAL OUTCOME</span>
        <h2 id="active-outcome-studies-heading">One active move. One downstream task.</h2>
        <p>Less purple, no timeline rail, and one standardized task grammar. The top fixture identifies what should be active now and points to a real task-shaped consequence instead of motivational prose.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture data truth</strong>
        <span>Pot up · Sweet William is a real open Atlas task: Grow Room · 3 trays · 600 plants. Atlas does not currently contain an exact Sweet William first-harvest projection, so the fixture stops at Apr 2027 rather than inventing a day.</span>
      </div>
      <div className={styles.gallery}>
        <ClockToHarvest />
        <CompactTargetStrip />
        <HeaderLedger />
      </div>
    </section>
  );
}
