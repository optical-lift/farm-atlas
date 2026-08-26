import type { ReactNode } from "react";

import styles from "./active-outcome-studies.module.css";

type TaskDatum = {
  family: string;
  title: string;
  place: string;
  amount: string;
  window: string;
  date: string;
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
    date: "Aug 26",
    clock: "7:00",
  },
  {
    family: "WEED",
    title: "MG11",
    place: "Main Garden",
    amount: "30 min · Heavy",
    window: "Morning",
    date: "Aug 24",
    clock: "8:30",
  },
  {
    family: "POT UP",
    title: "Sweet William",
    place: "Grow Room",
    amount: "3 trays · 600 plants",
    window: "Midafternoon",
    date: "Aug 24",
    clock: "2:30",
    unlock: "Harvest Stems · May 6",
  },
  {
    family: "SPRAY",
    title: "BB10 · Bermuda Pass 1",
    place: "Barn Beds",
    amount: "20 min · Pass 1 of 3",
    window: "Evening",
    date: "Aug 26",
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

function MiniToggle({ active }: { active: "timeline" | "daybook" }) {
  return (
    <div className={styles.miniToggle} aria-label="Fixture view toggle">
      <span data-active={active === "timeline" ? "true" : "false"}>Timeline</span>
      <span data-active={active === "daybook" ? "true" : "false"}>Daybook</span>
    </div>
  );
}

function DayHeader({ active }: { active: "timeline" | "daybook" }) {
  return (
    <section className={styles.dayHeader}>
      <div className={styles.dayIdentity}>
        <span>WEDNESDAY</span>
        <strong>Aug 26</strong>
      </div>
      <MiniToggle active={active} />
      <div className={styles.dayProgress}>
        <span>6 of 11 finished</span>
        <i aria-hidden="true"><b /></i>
      </div>
    </section>
  );
}

function Phone({ view, children }: { view: "timeline" | "daybook"; children: ReactNode }) {
  return (
    <div className={styles.phone} data-view={view}>
      <AppHeader />
      <DayHeader active={view} />
      {children}
      <footer className={styles.nav}>
        <span>Home</span><strong>Clock</strong><span>Manager</span><span>Harvest</span><span>More</span>
      </footer>
    </div>
  );
}

function FocusCard({ variant = "plain" }: { variant?: "plain" | "split" | "line" }) {
  return (
    <section className={styles.focusCard} data-variant={variant}>
      <div className={styles.dayCount}>
        <strong>11</strong>
        <span>tasks</span>
        <small>6 done</small>
      </div>
      <div className={styles.focusTask}>
        <span>{ACTIVE_TASK.family}</span>
        <strong>{ACTIVE_TASK.title}</strong>
        <div className={styles.unlockLine}><b>UNLOCKS</b><span>Harvest Stems · May 6</span></div>
      </div>
      <div className={styles.overdueDock}>
        <div><b>OVERDUE · 2</b><span>showing the one that matters now</span></div>
        <div className={styles.overdueRow}>
          <strong>Pot up · Sweet William</strong>
          <span>Aug 24</span>
          <i aria-hidden="true" />
          <b>Harvest Stems · May 6</b>
        </div>
        <small>+1 hidden</small>
      </div>
    </section>
  );
}

function CalendarGrid({ variant }: { variant: "classic" | "slim" | "window" }) {
  return (
    <section className={styles.calendar} data-variant={variant} aria-label="Google Calendar style fixture">
      <div className={styles.hourGutter}>
        {HOURS.map((hour) => <span key={hour}>{hour}</span>)}
      </div>
      <div className={styles.calendarBody}>
        {HOURS.map((hour) => <i className={styles.hourRule} key={hour} />)}
        {variant === "window" ? <div className={styles.windowShade}>MIDAFTERNOON</div> : null}
        <div className={styles.calendarEvent} data-kind="round" style={{ top: "6%", height: "10%" }}>
          <b>7:00</b><strong>Farm Round</strong><span>Elm Farm</span>
        </div>
        <div className={styles.calendarEvent} data-kind="weed" style={{ top: "20%", height: "11%" }}>
          <b>8:30</b><strong>MG11</strong><span>Main Garden</span>
        </div>
        <div className={styles.calendarEvent} data-active="true" style={{ top: "58%", height: "14%" }}>
          <b>2:30</b><strong>Sweet William</strong><span>Pot up · 3 trays</span><small>Harvest Stems · May 6</small>
        </div>
        <div className={styles.calendarEvent} data-kind="spray" style={{ top: "86%", height: "10%" }}>
          <b>7:00</b><strong>BB10</strong><span>Spray · Pass 1 of 3</span>
        </div>
        <div className={styles.nowRule} style={{ top: "61%" }}><span>2:34</span></div>
      </div>
    </section>
  );
}

function TaskMeta({ task }: { task: TaskDatum }) {
  return (
    <>
      <span className={styles.taskFamily}>{task.family}</span>
      <strong>{task.title}</strong>
      <small>{task.place} · {task.amount}</small>
    </>
  );
}

function RailFeed({ variant }: { variant: "branch" | "alternating" | "lanes" }) {
  return (
    <section className={styles.railFeed} data-variant={variant} aria-label="Mind map task feed fixture">
      <header><span>MIDAFTERNOON</span><small>3 remaining</small></header>
      <div className={styles.railBody}>
        {TASKS.slice(1).map((task) => (
          <article className={styles.railNode} data-active={task === ACTIVE_TASK ? "true" : "false"} key={task.title}>
            <div className={styles.nodeTime}><strong>{task.window}</strong><span>{task.clock}</span></div>
            <i className={styles.nodeDot} aria-hidden="true" />
            <div className={styles.nodeTask}><TaskMeta task={task} /></div>
            {task.unlock ? (
              <div className={styles.nodeUnlock}>
                <i aria-hidden="true" />
                <span>UNLOCKS</span>
                <strong>{task.unlock}</strong>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function StudyPair({ label, note, calendarVariant, railVariant, focusVariant }: {
  label: string;
  note: string;
  calendarVariant: "classic" | "slim" | "window";
  railVariant: "branch" | "alternating" | "lanes";
  focusVariant: "plain" | "split" | "line";
}) {
  return (
    <section className={styles.studyPair}>
      <header className={styles.studyLabel}><strong>{label}</strong><span>{note}</span></header>
      <div className={styles.viewPair}>
        <div className={styles.viewStudy}>
          <span>CLOCK VIEW</span>
          <Phone view="timeline"><CalendarGrid variant={calendarVariant} /></Phone>
        </div>
        <div className={styles.viewStudy}>
          <span>DAYBOOK VIEW</span>
          <Phone view="daybook"><FocusCard variant={focusVariant} /><RailFeed variant={railVariant} /></Phone>
        </div>
      </div>
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
        <span>DAYBOOK STUDY 3 · ONE CLOCK, TWO LENSES</span>
        <h2 id="active-outcome-studies-heading">Calendar on Clock. Causal map on Daybook.</h2>
        <p>Three paired studies. The tiny Timeline / Daybook toggle stays subordinate to the day. Clock becomes a calendar. Daybook becomes a task-and-consequence map with one active move, a compact overdue dock, and standardized task data.</p>
      </header>
      <div className={styles.dataNote}>
        <strong>Fixture truth boundary</strong>
        <span>Sweet William is the real open 3-tray / 600-plant pot-up task and its crop profile now carries a May 1–June 30, 2027 harvest-watch window. “Harvest Stems · May 6” is the owner-requested design fixture for testing the future-task link; Atlas does not yet materialize an exact May 6 harvest task.</span>
      </div>
      <div className={styles.gallery}>
        <StudyPair
          label="A · Calendar + branch rail"
          note="Closest to the current Day overview: classic calendar blocks on Clock, one clean left rail with unlock branches on Daybook."
          calendarVariant="classic"
          railVariant="branch"
          focusVariant="plain"
        />
        <StudyPair
          label="B · Quiet schedule + alternating map"
          note="More white space: slimmer calendar events and task nodes that alternate around a central dependency spine."
          calendarVariant="slim"
          railVariant="alternating"
          focusVariant="split"
        />
        <StudyPair
          label="C · Work window + dependency lanes"
          note="The active work window is visible on Clock; Daybook separates task identity from downstream unlocks into two connected lanes."
          calendarVariant="window"
          railVariant="lanes"
          focusVariant="line"
        />
      </div>
    </section>
  );
}
