"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "./weed-card-specimen.module.css";

const SOWN_ON = new Date("2026-08-16T12:00:00-05:00");
const HARVEST_START = new Date("2026-10-04T12:00:00-05:00");
const HARVEST_END = new Date("2026-10-14T12:00:00-05:00");

const BED_WIDTH_FT = 3;
const BED_LENGTH_FT = 30;
const MAP_BLOCK_FT = 3;

const bedTrail = [
  { label: "Weeded", detail: "Jul 23", state: "done" },
  { label: "Sown", detail: "Aug 16 · Orange", state: "done" },
  { label: "Weed", detail: "today", state: "now" },
  { label: "Germination", detail: "Aug 20–26", state: "later" },
  { label: "Harvest", detail: "Oct 4–14", state: "later" },
] as const;

const mapBlocks = Array.from({ length: BED_LENGTH_FT / MAP_BLOCK_FT }, (_, index) => ({
  start: index * MAP_BLOCK_FT,
  end: (index + 1) * MAP_BLOCK_FT,
}));

function dayDiff(from: Date, to: Date) {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

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
  const [selectedBlock, setSelectedBlock] = useState(0);

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

  const activeBlock = mapBlocks[selectedBlock];

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
          <small>{BED_WIDTH_FT} ft × {BED_LENGTH_FT} ft · one mark = 1 sq ft</small>
        </header>

        <div className={styles.bedRectangle} aria-label="Square-foot crop map for Field Row 13">
          {mapBlocks.map((block, blockIndex) => (
            <button
              type="button"
              className={blockIndex === selectedBlock ? styles.mapBlockActive : styles.mapBlock}
              key={block.start}
              onClick={() => setSelectedBlock(blockIndex)}
              aria-label={`Feet ${block.start} to ${block.end}, ProCut Orange sunflower`}
            >
              {Array.from({ length: BED_WIDTH_FT * MAP_BLOCK_FT }, (_, squareIndex) => (
                <span key={squareIndex}>o</span>
              ))}
            </button>
          ))}
        </div>

        <div className={styles.mapScale} aria-hidden="true">
          <span>0 ft</span>
          <span>15 ft</span>
          <span>30 ft</span>
        </div>

        <div className={styles.mapDetail}>
          <span>{activeBlock.start}–{activeBlock.end} ft</span>
          <strong>ProCut Orange sunflower</strong>
          <small>{BED_WIDTH_FT * MAP_BLOCK_FT} sq ft shown · tap another section to inspect it</small>
        </div>

        <div className={styles.mapLegend}><code>o</code> sunflower square</div>
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
