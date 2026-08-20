"use client";

import { useEffect, useMemo, useState } from "react";

import DominionCardFrame from "./DominionCardFrame";
import adjust from "./sow-card-adjust.module.css";
import styles from "./sow-card-specimen.module.css";

const bedTrail = [
  { label: "Prepared", detail: "bed ready", state: "done" },
  { label: "Sow", detail: "White Lite", state: "now" },
  { label: "Germination", detail: "4–10 days", state: "later" },
  { label: "Harvest", detail: "50–60 days", state: "later" },
  { label: "Clear", detail: "75 days", state: "later" },
] as const;

const factCards = [
  { label: "Rows", value: "3 rows" },
  { label: "Spacing", value: "4 in" },
  { label: "Seed estimate", value: "~270 seeds" },
] as const;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function monthDay(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  }).format(date);
}

function dateRange(start: Date, end: Date) {
  const monthFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short" });
  const dayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", day: "numeric" });
  const startMonth = monthFormatter.format(start);
  const endMonth = monthFormatter.format(end);
  const startDay = dayFormatter.format(start);
  const endDay = dayFormatter.format(end);
  return startMonth === endMonth ? `${startMonth} ${startDay}–${endDay}` : `${startMonth} ${startDay}–${endMonth} ${endDay}`;
}

function SurprisePill({ label }: { label: string }) {
  const id = `sow-surprise-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <label className={styles.surprisePill} htmlFor={id}>
      <input id={id} type="checkbox" />
      <span>{label}</span>
    </label>
  );
}

function LogItDrawer() {
  return (
    <details className={styles.logDrawer}>
      <summary>Log it</summary>
      <div className={styles.logPanel}>
        <input type="text" placeholder="Add note…" aria-label="Add a sowing note" />
        <button type="button">Save note</button>
      </div>
    </details>
  );
}

export default function SowCardSpecimen() {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => { setToday(new Date()); }, []);

  const projections = useMemo(() => {
    if (!today) return { bloom: "Updating…", clear: "Updating…" };
    return { bloom: dateRange(addDays(today, 50), addDays(today, 60)), clear: monthDay(addDays(today, 75)) };
  }, [today]);

  return (
    <DominionCardFrame family="Sow" title="Field Row 6" subtitle="Field Rows">
      <div className={styles.trail} aria-label="Field Row 6 crop-cycle trail">
        {bedTrail.map((step) => (
          <span className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater} key={step.label}>
            <b>{step.label}</b>
            <small>{step.detail}</small>
          </span>
        ))}
      </div>

      <section className={styles.bedSection}>
        <header className={styles.bedHeader}>
          <div><h3 className={adjust.bedTitle}>Field Row 6</h3><span>Field Rows</span></div>
        </header>
        <div className={styles.seedRow}><small>Seed</small><strong>ProCut White Lite</strong></div>
        <div className={styles.factRow}>
          {factCards.map((fact) => <div key={fact.label}><small>{fact.label}</small><strong>{fact.value}</strong></div>)}
        </div>
      </section>

      <section className={styles.projections}>
        <header><span>Projections</span><small>from today’s real calendar date</small></header>
        <div className={styles.projectionGrid}>
          <div><small>Bloom / harvest window</small><strong>{projections.bloom}</strong></div>
          <div><small>Ready to clear</small><strong>{projections.clear}</strong></div>
        </div>
      </section>

      <section className={styles.surprises}>
        <header><span>Surprises</span><small>only if something differed</small></header>
        <div className={styles.surprisePills}>
          <SurprisePill label="It was weedy" />
          <SurprisePill label="Ran out of seeds" />
          <LogItDrawer />
        </div>
      </section>
    </DominionCardFrame>
  );
}
