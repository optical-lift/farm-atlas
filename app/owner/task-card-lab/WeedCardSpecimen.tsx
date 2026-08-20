"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "./weed-card-specimen.module.css";

const SOWN_ON = new Date("2026-08-16T12:00:00-05:00");
const HARVEST_START = new Date("2026-10-04T12:00:00-05:00");
const HARVEST_END = new Date("2026-10-14T12:00:00-05:00");

const BED_WIDTH_FT = 3;
const BED_LENGTH_FT = 30;
const PLANT_ROWS = 3;
const IN_ROW_SPACING_IN = 4;
const SEGMENT_FT = 10;

const bedTrail = [
  { label: "Weeded", detail: "Jul 23", state: "done" },
  { label: "Sown", detail: "Aug 16 · Orange", state: "done" },
  { label: "Weed", detail: "today", state: "now" },
  { label: "Germination", detail: "Aug 20–26", state: "later" },
  { label: "Harvest", detail: "Oct 4–14", state: "later" },
] as const;

function dayDiff(from: Date, to: Date) {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

function renderBedSegment(startFoot: number) {
  const cells = Array.from({ length: SEGMENT_FT }, () => "ooo");
  const horizontal = Array.from({ length: SEGMENT_FT }, () => "───");
  const top = `┌${horizontal.join("┬")}┐`;
  const middle = `├${horizontal.join("┼")}┤`;
  const bottom = `└${horizontal.join("┴")}┘`;
  const cropRow = `│${cells.join("│")}│`;

  return {
    label: `${startFoot}–${startFoot + SEGMENT_FT} ft`,
    drawing: [top, cropRow, middle, cropRow, middle, cropRow, bottom].join("\n"),
  };
}

const bedSegments = Array.from(
  { length: BED_LENGTH_FT / SEGMENT_FT },
  (_, index) => renderBedSegment(index * SEGMENT_FT),
);

function ResultPill({ label }: { label: string }) {
  const id = `weed-result-${label.toLowerCase().replaceAll(" ", "-")}`;

  return (
    <label className={styles.resultPill} htmlFor={id}>
      <input id={id} type="radio" name="weed-result" />
      <span>{label}</span>
    </label>
  );
}

function LogItDrawer() {
  return (
    <details className={styles.logDrawer}>
      <summary>Log it</summary>
      <div className={styles.logPanel}>
        <input type="text" placeholder="Add note…" aria-label="Add a weeding note" />
        <button type="button">Save note</button>
      </div>
    </details>
  );
}

export default function WeedCardSpecimen() {
  const [today, setToday] = useState<Date | null>(null);

  useEffect(() => {
    setToday(new Date());
  }, []);

  const cropTiming = useMemo(() => {
    if (!today) {
      return {
        stage: "Updating…",
        harvest: "Updating…",
      };
    }

    const day = dayDiff(SOWN_ON, today);
    const toHarvestStart = Math.round((HARVEST_START.getTime() - today.getTime()) / 86_400_000);
    const toHarvestEnd = Math.round((HARVEST_END.getTime() - today.getTime()) / 86_400_000);

    let harvest = "Harvest watch now";
    if (toHarvestEnd < 0) harvest = "Harvest window passed";
    else if (toHarvestStart > 0) harvest = `${toHarvestStart}–${toHarvestEnd} days to harvest watch`;

    return {
      stage: `Day ${day} since sowing`,
      harvest,
    };
  }, [today]);

  const estimatedPositions = Math.round(
    (BED_LENGTH_FT * 12 / IN_ROW_SPACING_IN) * PLANT_ROWS,
  );

  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>Weed</span>
          <small>bed care</small>
        </div>
        <h2>Field Row 13</h2>
        <p>Field Rows</p>
        <div className={styles.timing}>Today · weeding due</div>
      </header>

      <div className={styles.trail} aria-label="Field Row 13 history and next crop-cycle moves">
        {bedTrail.map((step) => (
          <span
            className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater}
            key={step.label}
          >
            <b>{step.label}</b>
            <small>{step.detail}</small>
          </span>
        ))}
      </div>

      <section className={styles.cropState}>
        <span>Bed now</span>
        <strong>ProCut Orange sunflower</strong>
        <div>
          <b>{cropTiming.stage}</b>
          <b>{cropTiming.harvest}</b>
        </div>
      </section>

      <section className={styles.bedMap}>
        <header>
          <span>Bed map</span>
          <small>{BED_WIDTH_FT} ft × {BED_LENGTH_FT} ft · each box = 1 sq ft</small>
        </header>
        <div className={styles.mapMeta}>
          <b>{PLANT_ROWS} rows</b>
          <b>{IN_ROW_SPACING_IN} in spacing</b>
          <b>~{estimatedPositions} positions</b>
        </div>
        <div className={styles.mapSegments} aria-label="Expected sunflower positions in Field Row 13">
          {bedSegments.map((segment) => (
            <figure key={segment.label}>
              <figcaption>{segment.label}</figcaption>
              <pre>{segment.drawing}</pre>
            </figure>
          ))}
        </div>
        <div className={styles.mapLegend}><code>o</code> expected sunflower position</div>
      </section>

      <section className={styles.results}>
        <header>
          <span>How’d we do?</span>
        </header>
        <div className={styles.resultPills}>
          <ResultPill label="Still rough" />
          <ResultPill label="Crop readable" />
          <ResultPill label="Clear" />
          <LogItDrawer />
        </div>
      </section>

      <footer className={styles.finish}>
        <span>Finish Weed</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Done weeding today</button>
          <button type="button">Blocked</button>
        </div>
      </footer>
    </article>
  );
}
