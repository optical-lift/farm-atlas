"use client";

import { useMemo, useState } from "react";

import styles from "./clock-day-lab.module.css";

type Lens = "timeline" | "feed";
type FixtureState = "clocked_in" | "before_shift" | "overloaded" | "complete";

type FeedItem = {
  time: string;
  window: string;
  title: string;
  place: string;
  status: "now" | "next" | "later" | "done" | "overdue";
  duration?: string;
};

const FIXTURE_STATES: Array<{ key: FixtureState; label: string }> = [
  { key: "clocked_in", label: "Clocked in" },
  { key: "before_shift", label: "Before shift" },
  { key: "overloaded", label: "Overloaded" },
  { key: "complete", label: "Day complete" },
];

const BASE_ITEMS: FeedItem[] = [
  { time: "7:30", window: "Morning", title: "Harvest Mary’s flowers", place: "Mary’s", status: "done", duration: "1 hr 45" },
  { time: "9:30", window: "Morning", title: "Weed MG11", place: "Main Garden", status: "now", duration: "30 min" },
  { time: "10:15", window: "Morning", title: "String Barn Beds", place: "Barn Beds", status: "next", duration: "35 min" },
  { time: "1:00", window: "Afternoon", title: "Venue reset", place: "Farmhouse", status: "later", duration: "25 min" },
  { time: "7:00", window: "Evening", title: "Spray BB10", place: "Barn Beds", status: "later", duration: "20 min" },
];

function fixtureItems(state: FixtureState) {
  if (state === "before_shift") {
    return BASE_ITEMS.map((item, index) => ({ ...item, status: index === 0 ? "next" as const : "later" as const }));
  }
  if (state === "overloaded") {
    return [
      { time: "carried", window: "Recovery", title: "Push mow orchard edge", place: "Orchard", status: "overdue" as const, duration: "40 min" },
      ...BASE_ITEMS.map((item, index) => ({ ...item, status: index === 0 ? "now" as const : index === 1 ? "next" as const : "later" as const })),
    ];
  }
  if (state === "complete") {
    return BASE_ITEMS.map((item) => ({ ...item, status: "done" as const }));
  }
  return BASE_ITEMS;
}

function stateCopy(state: FixtureState) {
  if (state === "before_shift") return { action: "Clock in", hours: "0h 00m", week: "19h 48m", status: "Shift not started" };
  if (state === "overloaded") return { action: "Clocked in", hours: "3h 06m", week: "22h 54m", status: "1 carried item needs recovery" };
  if (state === "complete") return { action: "Clocked out", hours: "7h 18m", week: "27h 06m", status: "Day complete" };
  return { action: "Clocked in", hours: "2h 42m", week: "22h 30m", status: "MG11 is active now" };
}

function StatusDot({ status }: { status: FeedItem["status"] }) {
  return <span className={styles.statusDot} data-status={status} aria-hidden="true" />;
}

function FeedRows({ items, compact = false }: { items: FeedItem[]; compact?: boolean }) {
  return (
    <div className={compact ? styles.feedRowsCompact : styles.feedRows}>
      {items.map((item, index) => (
        <article className={styles.feedRow} data-status={item.status} key={`${item.title}-${index}`}>
          <div className={styles.feedTime}>{item.time}</div>
          <StatusDot status={item.status} />
          <div className={styles.feedCopy}>
            <span>{item.window}</span>
            <strong>{item.title}</strong>
            <small>{item.place}{item.duration ? ` · ${item.duration}` : ""}</small>
          </div>
          <div className={styles.feedState}>{item.status === "now" ? "NOW" : item.status === "next" ? "NEXT" : item.status === "overdue" ? "CARRIED" : item.status === "done" ? "DONE" : ""}</div>
        </article>
      ))}
    </div>
  );
}

function Timeline({ items }: { items: FeedItem[] }) {
  return (
    <div className={styles.timeline}>
      <div className={styles.timelineRail} aria-hidden="true" />
      {items.map((item, index) => (
        <article className={styles.timelineBlock} data-status={item.status} key={`${item.title}-${index}`}>
          <span className={styles.timelineTime}>{item.time}</span>
          <div>
            <small>{item.window}</small>
            <strong>{item.title}</strong>
            <span>{item.place}{item.duration ? ` · ${item.duration}` : ""}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function TimeCard({ state }: { state: FixtureState }) {
  const copy = stateCopy(state);
  return (
    <section className={styles.timeCard}>
      <div>
        <small>SHIFT</small>
        <strong>{copy.action}</strong>
        <span>{copy.status}</span>
      </div>
      <div className={styles.hours}>
        <div><small>TODAY</small><strong>{copy.hours}</strong></div>
        <div><small>WEEK</small><strong>{copy.week}</strong></div>
      </div>
    </section>
  );
}

function PhoneFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section className={styles.concept}>
      <div className={styles.conceptLabel}>{label}</div>
      <div className={styles.phone}>{children}</div>
    </section>
  );
}

function ConceptOne({ state }: { state: FixtureState }) {
  const [lens, setLens] = useState<Lens>("timeline");
  const items = useMemo(() => fixtureItems(state), [state]);
  const active = items.find((item) => item.status === "now");
  const next = items.find((item) => item.status === "next");

  return (
    <PhoneFrame label="A · One Clock, two lenses">
      <header className={styles.phoneHeader}>
        <div><span>ATLAS</span><strong>Clock</strong></div>
        <button type="button" disabled aria-label="Fixture menu">•••</button>
      </header>
      <div className={styles.dateStrip}><button disabled>←</button><strong>Wednesday · Aug 26</strong><button disabled>→</button></div>
      <TimeCard state={state} />
      <nav className={styles.lensSwitch} aria-label="Clock design fixture lens">
        <button type="button" data-active={lens === "timeline"} onClick={() => setLens("timeline")}>Timeline</button>
        <button type="button" data-active={lens === "feed"} onClick={() => setLens("feed")}>Day Feed</button>
      </nav>
      <section className={styles.nowNext}>
        <div><small>NOW</small><strong>{active?.title ?? (state === "complete" ? "Day complete" : "Not working yet")}</strong><span>{active?.place ?? "Elm Farm"}</span></div>
        <div><small>NEXT</small><strong>{next?.title ?? "Nothing waiting"}</strong><span>{next?.place ?? ""}</span></div>
      </section>
      <div className={styles.lensBody}>{lens === "timeline" ? <Timeline items={items} /> : <FeedRows items={items} />}</div>
      <footer className={styles.mockNav}><span>Home</span><strong>Clock</strong><span>Bell</span><span>Me</span></footer>
    </PhoneFrame>
  );
}

function ConceptTwo({ state }: { state: FixtureState }) {
  const items = fixtureItems(state);
  const copy = stateCopy(state);
  return (
    <PhoneFrame label="B · Feed first, clock persistent">
      <header className={styles.compactHeader}>
        <div><span>Wednesday · Aug 26</span><strong>Your day</strong></div>
        <div className={styles.compactClock}><small>{copy.action}</small><strong>{copy.hours}</strong></div>
      </header>
      <div className={styles.slimMode}><button type="button" disabled>Feed</button><button type="button" disabled>Timeline</button></div>
      <div className={styles.feedFirstLead}>
        <small>{state === "overloaded" ? "RECOVERY FIRST" : state === "complete" ? "FINISHED" : "YOUR NEXT MOVE"}</small>
        <strong>{items.find((item) => item.status === "now")?.title ?? items.find((item) => item.status === "next")?.title ?? "Everything is finished"}</strong>
        <span>{items.find((item) => item.status === "now")?.place ?? items.find((item) => item.status === "next")?.place ?? "Elm Farm"}</span>
      </div>
      <FeedRows items={items} compact />
      <div className={styles.weekStrip}><span>This week</span><strong>{copy.week}</strong><span>Clock details ›</span></div>
      <footer className={styles.mockNav}><span>Home</span><strong>Clock</strong><span>Bell</span><span>Me</span></footer>
    </PhoneFrame>
  );
}

function ConceptThree({ state }: { state: FixtureState }) {
  const items = fixtureItems(state);
  const copy = stateCopy(state);
  return (
    <PhoneFrame label="C · Living daybook">
      <header className={styles.daybookHeader}>
        <span>WEDNESDAY</span>
        <strong>26</strong>
        <div><b>{copy.action}</b><small>{copy.hours} today</small></div>
      </header>
      <div className={styles.daybookRule}><span>6 AM</span><i /><span>10 PM</span></div>
      <div className={styles.daybookList}>
        {items.map((item, index) => (
          <article className={styles.daybookEntry} data-status={item.status} key={`${item.title}-${index}`}>
            <div><small>{item.time}</small><StatusDot status={item.status} /></div>
            <div><span>{item.window}</span><strong>{item.title}</strong><small>{item.place}{item.duration ? ` · ${item.duration}` : ""}</small></div>
          </article>
        ))}
      </div>
      <div className={styles.daybookFooter}><strong>{copy.week}</strong><span>this week</span><button type="button" disabled>Timeline ↔ Feed</button></div>
      <footer className={styles.mockNav}><span>Home</span><strong>Clock</strong><span>Bell</span><span>Me</span></footer>
    </PhoneFrame>
  );
}

export default function ClockDayLab() {
  const [fixtureState, setFixtureState] = useState<FixtureState>("clocked_in");

  return (
    <main
      className={styles.page}
      data-atlas-clock-day-lab="fixture-only"
      data-live-worker-binding="none"
      data-task-transition-capability="none"
    >
      <header className={styles.labHeader}>
        <span>ATLAS · OWNER DESIGN LAB</span>
        <h1>Clock + Day</h1>
        <p>One worker service-day surface. Timeline and Day Feed are lenses over the same day, not separate work systems.</p>
        <div className={styles.safetyBanner}><strong>DESIGN FIXTURES ONLY</strong><span>No worker-day runtime · no task transitions · no Supabase writes</span></div>
      </header>

      <section className={styles.contract} aria-label="Clock Day design contract">
        <div><small>ONE HOME</small><strong>Clock owns the service day</strong></div>
        <div><small>TWO LENSES</small><strong>Timeline + Day Feed</strong></div>
        <div><small>ONE TRUTH</small><strong>No duplicate scheduling logic</strong></div>
        <div><small>FUTURE NAV</small><strong>Work tab disappears</strong></div>
      </section>

      <section className={styles.statePicker} aria-label="Fixture state selector">
        <span>Stress-test all concepts:</span>
        <div>
          {FIXTURE_STATES.map((state) => (
            <button
              type="button"
              data-active={fixtureState === state.key}
              key={state.key}
              onClick={() => setFixtureState(state.key)}
            >
              {state.label}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.gallery}>
        <ConceptOne state={fixtureState} />
        <ConceptTwo state={fixtureState} />
        <ConceptThree state={fixtureState} />
      </section>

      <section className={styles.notes}>
        <h2>What this lab is allowed to decide</h2>
        <div className={styles.noteGrid}>
          <article><strong>Hierarchy</strong><span>How large clock status, NOW/NEXT, date, and the current task should feel.</span></article>
          <article><strong>Lens behavior</strong><span>Whether Timeline and Day Feed toggle, swipe, collapse, or coexist.</span></article>
          <article><strong>Recovery</strong><span>How carried work enters today without turning the worker view into project management.</span></article>
          <article><strong>Navigation</strong><span>How one Clock tab eventually replaces separate Clock and Work tabs.</span></article>
        </div>
      </section>
    </main>
  );
}
