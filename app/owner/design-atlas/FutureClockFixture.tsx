"use client";

import { AtlasCard } from "@/components/atlas/ui/AtlasPrimitives";
import styles from "./future-clock-fixture.module.css";

type ClockBlock = {
  time: string;
  end?: string;
  kind: "work" | "occupied" | "transition";
  title: string;
  context?: string;
  signal?: string;
  consequence?: string;
  state?: "now" | "next" | "later";
};

const BLOCKS: ClockBlock[] = [
  { time: "6:30", end: "6:50", kind: "occupied", title: "Coffee + porch", context: "Protected start of day" },
  { time: "6:50", end: "7:05", kind: "work", title: "Chicken chore", context: "Barn path", signal: "ROUTINE" },
  { time: "7:10", end: "8:00", kind: "work", title: "Harvest ProCut Orange", context: "Field Rows", signal: "3/5 rows", consequence: "UNLOCKS Friday florist route", state: "now" },
  { time: "8:00", end: "8:10", kind: "transition", title: "Buckets → Flower Room", context: "Context change" },
  { time: "8:10", end: "8:40", kind: "work", title: "Weed Field Row 13", context: "Field Rows", signal: "COOL WINDOW", state: "next" },
  { time: "9:00", end: "9:15", kind: "occupied", title: "Egg + water", context: "Protected food anchor" },
  { time: "9:20", end: "10:05", kind: "work", title: "Transplant cabbage into MG7", context: "Main Garden", signal: "READ FIRST", consequence: "UNLOCKS fall cabbage cycle" },
  { time: "10:15", end: "10:45", kind: "work", title: "Sow ProCut White Lite", context: "Barn Beds", signal: "WINDOW CLOSES TODAY" },
  { time: "12:00", end: "12:35", kind: "occupied", title: "Lunch", context: "Reserved capacity · not a task" },
  { time: "1:15", end: "1:45", kind: "work", title: "Call woodchip suppliers", context: "Farm admin", signal: "4/7 calls" },
  { time: "2:00", end: "2:35", kind: "work", title: "Reset Farmhouse", context: "Venue", signal: "2/4 rooms", consequence: "UNLOCKS Thursday workshop" },
  { time: "3:00", end: "3:45", kind: "occupied", title: "Springfield delivery", context: "Fixed commitment + travel" },
  { time: "4:10", end: "4:30", kind: "work", title: "Grow Room round", context: "Propagation", signal: "CHANGED — READ AGAIN" },
];

function timeLabel(block: ClockBlock) {
  return block.end ? `${block.time}–${block.end}` : block.time;
}

export default function FutureClockFixture() {
  const now = BLOCKS.find((block) => block.state === "now")!;
  const next = BLOCKS.find((block) => block.state === "next")!;

  return (
    <section
      className={styles.clock}
      data-atlas-future-clock="dropbox-governed-v1"
      data-live-data-binding="none"
      data-mutation-capability="none"
    >
      <header className={styles.header}>
        <div>
          <span>FUTURE FARM CLOCK · APPROVED DIRECTION</span>
          <h2>Saturday, Aug 29</h2>
          <p>Compiled day · 7:36 AM</p>
        </div>
        <div className={styles.dayBoundary}><small>WORKDAY</small><strong>6:50–4:30</strong></div>
      </header>

      <div className={styles.focusGrid}>
        <AtlasCard variant="purple" className={styles.nowCard}>
          <span className={styles.eyebrow}>NOW</span>
          <small>{timeLabel(now)}</small>
          <h3>{now.title}</h3>
          <p>{now.context} · {now.signal}</p>
          {now.consequence ? <div className={styles.unlock}><b>UNLOCKS</b><span>{now.consequence.replace("UNLOCKS ", "")}</span></div> : null}
          <button type="button">Open work</button>
        </AtlasCard>

        <AtlasCard className={styles.nextCard}>
          <span className={styles.eyebrow}>NEXT</span>
          <small>{timeLabel(next)}</small>
          <h3>{next.title}</h3>
          <p>{next.context} · {next.signal}</p>
        </AtlasCard>
      </div>

      <div className={styles.ruleLine}>
        <span><b>NOW</b> gets ownership of attention.</span>
        <span><b>NEXT</b> prevents surprise.</span>
        <span><b>Everything else</b> stays quiet.</span>
      </div>

      <div className={styles.timeline} aria-label="Future Clock compiled day">
        <div className={styles.nowLine}><span>7:36</span><i /></div>
        {BLOCKS.map((block) => (
          <article
            key={`${block.time}-${block.title}`}
            className={styles.block}
            data-kind={block.kind}
            data-state={block.state ?? "later"}
          >
            <time>{timeLabel(block)}</time>
            <div>
              <strong>{block.title}</strong>
              <span>{block.context}</span>
            </div>
            {block.signal ? <em>{block.signal}</em> : null}
            {block.consequence && block.state !== "now" ? <small>↳ {block.consequence}</small> : null}
          </article>
        ))}
      </div>

      <div className={styles.behaviorGrid}>
        <AtlasCard className={styles.behaviorCard}>
          <span>OCCUPIED TIME</span>
          <h3>Capacity without fake tasks</h3>
          <p>Meals, appointments, travel, family anchors and other real commitments occupy the geometry without becoming farm-task completions.</p>
        </AtlasCard>
        <AtlasCard className={styles.behaviorCard}>
          <span>PROGRESSIVE SIGNAL</span>
          <h3>Two facts, maximum</h3>
          <p>Progress, readiness, consequence or execution context earns pixels only when it materially changes understanding of the move.</p>
        </AtlasCard>
        <AtlasCard className={styles.behaviorCard}>
          <span>REALITY REFLOW</span>
          <h3>Record reality once</h3>
          <p>When work runs long, a dependency changes, or a fixed commitment moves, Atlas rechoreographs the remaining lawful day instead of asking the worker to rebuild it.</p>
        </AtlasCard>
      </div>

      <details className={styles.endDay}>
        <summary><span>END-OF-DAY RECONCILIATION</span><strong>Unresolved work does not disappear</strong><b aria-hidden="true">⌄</b></summary>
        <div>
          <article><b>CARRY</b><span>Still required and lawfully fits next day.</span></article>
          <article><b>RESCHEDULE</b><span>Belongs later because of timing, dependency, resource or lifecycle truth.</span></article>
          <article><b>EXPIRE</b><span>The real opportunity no longer exists.</span></article>
          <article><b>NEEDS MANAGEMENT</b><span>Atlas cannot safely choose the disposition.</span></article>
        </div>
      </details>

      <footer className={styles.footer}>
        <b>Design boundary</b>
        <span>This is a future-build specimen, not a claim that these behaviors are implemented. It is governed by the Dropbox Clock handoff, Weekly Farm Contract, and Silent Intelligence direction.</span>
      </footer>
    </section>
  );
}
