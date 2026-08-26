import type { ReactNode } from "react";

import styles from "./unlock-move-studies.module.css";

const DAY_ITEMS = [
  { time: "1:00", family: "VENUE", title: "Venue reset", place: "Farmhouse" },
  { time: "2:30", family: "TRANSPLANT", title: "Pot up Sweet William", place: "Main Garden" },
  { time: "7:00", family: "TREATMENT", title: "Spray BB10", place: "Barn Beds" },
] as const;

function DayRail() {
  return (
    <section className={styles.dayRail} aria-label="Fixture day feed excerpt">
      <header className={styles.railHeader}>
        <span>MIDAFTERNOON</span>
        <small>3 remaining</small>
      </header>
      <div className={styles.railBody}>
        <span className={styles.railLine} aria-hidden="true" />
        {DAY_ITEMS.map((item, index) => (
          <article className={styles.railItem} key={item.title} data-focus={index === 1 ? "true" : "false"}>
            <div className={styles.time}>{item.time}</div>
            <span className={styles.dot} aria-hidden="true" />
            <div className={styles.taskCopy}>
              <span>{item.family}</span>
              <strong>{item.title}</strong>
              <small>{item.place}</small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className={styles.study}>
      <div className={styles.studyLabel}>{label}</div>
      <div className={styles.phone}>
        <header className={styles.appHeader}>
          <div><span>ATLAS</span><strong>Elm Farm</strong></div>
          <div className={styles.weather}>clear · 92°</div>
          <button type="button" disabled aria-label="Fixture add">+</button>
        </header>
        <div className={styles.modeSwitch}><span>Timeline</span><strong>Daybook</strong></div>
        <section className={styles.dateBlock}>
          <div><small>WEDNESDAY</small><strong>Aug 26</strong></div>
          <span>6 of 11 finished</span>
          <i aria-hidden="true"><b /></i>
        </section>
        {children}
        <DayRail />
        <footer className={styles.nav}><span>Home</span><strong>Clock</strong><span>Manager</span><span>More</span></footer>
      </div>
    </section>
  );
}

function SplitUnlock() {
  return (
    <Frame label="A · Move → bloom">
      <section className={`${styles.unlockCard} ${styles.splitCard}`}>
        <div className={styles.moveSide}>
          <small>NEXT MOVE · MIDAFTERNOON</small>
          <strong>Pot up Sweet William</strong>
        </div>
        <span className={styles.rule} aria-hidden="true" />
        <div className={styles.outcomeSide}>
          <small>GROWS INTO</small>
          <strong>April blooms</strong>
          <span>This move keeps them on track.</span>
        </div>
      </section>
    </Frame>
  );
}

function WindowUnlock() {
  return (
    <Frame label="B · Window first">
      <section className={`${styles.unlockCard} ${styles.windowCard}`}>
        <div className={styles.windowHead}>
          <small>MIDAFTERNOON</small>
          <span>next useful window</span>
        </div>
        <strong className={styles.windowTask}>Pot up Sweet William</strong>
        <div className={styles.windowTrack} aria-hidden="true"><i /><b /></div>
        <div className={styles.windowOutcome}>
          <span>Do this now</span>
          <strong>April blooms stay on track</strong>
        </div>
      </section>
    </Frame>
  );
}

function RelayUnlock() {
  return (
    <Frame label="C · One-line relay">
      <section className={`${styles.unlockCard} ${styles.relayCard}`}>
        <small>THE MOVE THAT MATTERS NEXT</small>
        <div className={styles.relayLine}>
          <strong>Pot up Sweet William</strong>
          <span aria-hidden="true" />
          <b>April blooms</b>
        </div>
        <div className={styles.relayMeta}><span>Midafternoon</span><span>Do it now to keep the bloom window.</span></div>
      </section>
    </Frame>
  );
}

export default function UnlockMoveStudies() {
  return (
    <section
      className={styles.section}
      data-atlas-unlock-move-studies="fixture-only"
      data-live-task-binding="none"
      aria-labelledby="unlock-move-studies-heading"
    >
      <header className={styles.sectionHeader}>
        <span>DAYBOOK STUDY · SINGLE CARROT</span>
        <h2 id="unlock-move-studies-heading">One upcoming move. One distant payoff.</h2>
        <p>The premium space never repeats the backlog. It picks one useful upcoming task for the current time window and carries the owner-selected end goal with it.</p>
      </header>
      <div className={styles.gallery}>
        <SplitUnlock />
        <WindowUnlock />
        <RelayUnlock />
      </div>
    </section>
  );
}
