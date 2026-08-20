"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "./weed-card-specimen.module.css";

const SOWN_ON = new Date("2026-08-16T12:00:00-05:00");
const HARVEST_START = new Date("2026-10-04T12:00:00-05:00");
const HARVEST_END = new Date("2026-10-14T12:00:00-05:00");

const BED_WIDTH_FT = 3;
const BED_LENGTH_FT = 30;
const MAP_BLOCK_FT = 3;

const weedTrail = [
  { label: "Weeded", detail: "Jul 23", state: "done" },
  { label: "Sown", detail: "Aug 16 · Orange", state: "done" },
  { label: "Weed", detail: "today", state: "now" },
  { label: "Germination", detail: "Aug 20–26", state: "later" },
  { label: "Harvest", detail: "Oct 4–14", state: "later" },
] as const;

const turnoverTrail = [
  { label: "Sown", detail: "Aug 16 · Orange", state: "done" },
  { label: "Harvest", detail: "Oct 4–14", state: "done" },
  { label: "Turn over", detail: "today", state: "now" },
  { label: "Rest", detail: "5 days", state: "later" },
  { label: "Cover crop", detail: "Oct 20", state: "later" },
] as const;

const mapBlocks = Array.from({ length: BED_LENGTH_FT / MAP_BLOCK_FT }, (_, index) => ({
  start: index * MAP_BLOCK_FT,
  end: (index + 1) * MAP_BLOCK_FT,
}));

function dayDiff(from: Date, to: Date) {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

function Trail({ steps, label }: { steps: readonly { label: string; detail: string; state: string }[]; label: string }) {
  return (
    <div className={styles.trail} aria-label={label}>
      {steps.map((step) => (
        <span
          className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater}
          key={`${step.label}-${step.detail}`}
        >
          <b>{step.label}</b>
          <small>{step.detail}</small>
        </span>
      ))}
    </div>
  );
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

function BedMap({ cropLabel, spent = false }: { cropLabel: string; spent?: boolean }) {
  const [selectedBlock, setSelectedBlock] = useState(0);
  const [logMode, setLogMode] = useState(false);
  const [loggedBlocks, setLoggedBlocks] = useState<number[]>([0]);

  const activeBlock = mapBlocks[selectedBlock];
  const selected = logMode ? loggedBlocks : [selectedBlock];
  const selectedSorted = [...selected].sort((a, b) => a - b);
  const first = mapBlocks[selectedSorted[0] ?? 0];
  const last = mapBlocks[selectedSorted[selectedSorted.length - 1] ?? 0];
  const contiguous = selectedSorted.every((value, index) => index === 0 || value === selectedSorted[index - 1] + 1);
  const selectionLabel = contiguous
    ? `${first.start}–${last.end} ft`
    : `${selectedSorted.length} sections`;
  const selectedSqFt = selectedSorted.length * BED_WIDTH_FT * MAP_BLOCK_FT;

  function selectBlock(blockIndex: number) {
    if (!logMode) {
      setSelectedBlock(blockIndex);
      setLoggedBlocks([blockIndex]);
      return;
    }

    setLoggedBlocks((current) => {
      if (current.includes(blockIndex)) {
        return current.length === 1 ? current : current.filter((index) => index !== blockIndex);
      }
      return [...current, blockIndex];
    });
  }

  function toggleLogMode() {
    if (!logMode) setLoggedBlocks([selectedBlock]);
    setLogMode((current) => !current);
  }

  return (
    <section className={styles.bedMap}>
      <header>
        <span>Bed map</span>
        <small>{BED_WIDTH_FT} ft × {BED_LENGTH_FT} ft</small>
      </header>

      <div className={styles.mapOrientation}>↑ back fence this side</div>

      <div className={styles.bedRectangle} aria-label={`Square-foot crop map for ${cropLabel}`}>
        {mapBlocks.map((block, blockIndex) => {
          const selectedForLog = logMode && loggedBlocks.includes(blockIndex);
          const inspected = !logMode && blockIndex === selectedBlock;
          return (
            <button
              type="button"
              className={selectedForLog || inspected ? styles.mapBlockActive : styles.mapBlock}
              key={block.start}
              onClick={() => selectBlock(blockIndex)}
              aria-label={`Feet ${block.start} to ${block.end}, ${cropLabel}`}
            >
              {Array.from({ length: BED_WIDTH_FT * MAP_BLOCK_FT }, (_, squareIndex) => (
                <span key={squareIndex}>o</span>
              ))}
            </button>
          );
        })}
      </div>

      <div className={styles.mapScale} aria-hidden="true">
        <span>0 ft</span>
        <span>15 ft</span>
        <span>30 ft</span>
      </div>

      <div className={styles.mapDetail}>
        <span>{logMode ? selectionLabel : `${activeBlock.start}–${activeBlock.end} ft`}</span>
        <strong>{cropLabel}</strong>
        <button type="button" className={styles.mapLogButton} onClick={toggleLogMode}>{logMode ? "Done" : "Log"}</button>
        <small>
          {logMode
            ? `${selectedSqFt} sq ft selected · tap neighboring sections to add or remove them`
            : `${BED_WIDTH_FT * MAP_BLOCK_FT} sq ft shown · tap another section to inspect it`}
        </small>

        {logMode ? (
          <div className={styles.mapLogPanel}>
            <div className={styles.mapLogPills}>
              <button type="button">Deer damage</button>
              <button type="button">Crop missing</button>
              <button type="button">Extra weedy</button>
              <button type="button">Other</button>
            </div>
            <div className={styles.mapLogNote}>
              <input type="text" placeholder="Add note…" aria-label="Add a bed-section note" />
              <button type="button">Save log</button>
            </div>
          </div>
        ) : null}
      </div>

      <div className={styles.mapLegend}><code>o</code> {spent ? "spent sunflower square" : "sunflower square"}</div>
    </section>
  );
}

function WeedCard() {
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

      <Trail steps={weedTrail} label="Field Row 13 history and next crop-cycle moves" />

      <section className={styles.cropState}>
        <span>Bed now</span>
        <strong>ProCut Orange sunflower</strong>
        <div>
          <b>{cropTiming.stage}</b>
          <b>{cropTiming.harvest}</b>
        </div>
      </section>

      <BedMap cropLabel="ProCut Orange sunflower" />

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

function TurnoverCheck({ id, label }: { id: string; label: string }) {
  return (
    <label className={styles.turnoverCheck} htmlFor={id}>
      <input id={id} type="checkbox" />
      <span aria-hidden="true" />
      <strong>{label}</strong>
    </label>
  );
}

function TurnoverCard() {
  return (
    <article className={styles.card}>
      <header className={styles.header}>
        <div className={styles.familyRow}>
          <span>Clear / Turn over</span>
          <small>bed turnover</small>
        </div>
        <h2>Field Row 13</h2>
        <p>Field Rows</p>
        <div className={styles.timing}>After final harvest · turnover due</div>
      </header>

      <Trail steps={turnoverTrail} label="Field Row 13 turnover and next bed phase" />

      <section className={styles.cropState}>
        <span>Bed now</span>
        <strong>Spent ProCut Orange sunflower</strong>
        <div>
          <b>Final harvest complete</b>
          <b>Biomass still in bed</b>
        </div>
      </section>

      <BedMap cropLabel="Spent ProCut Orange sunflower" spent />

      <section className={styles.turnoverBiomass}>
        <header><span>Biomass</span></header>
        <div>
          <small>Leaving the bed</small>
          <strong>Spent sunflower</strong>
        </div>
        <div>
          <small>Destination</small>
          <strong>Compost pile</strong>
        </div>
      </section>

      <section className={styles.turnoverActions}>
        <header>
          <span>Turn over</span>
          <small>3 steps</small>
        </header>
        <div>
          <TurnoverCheck id="turnover-remove" label="Remove spent crop from the bed" />
          <TurnoverCheck id="turnover-move" label="Move biomass to its destination" />
          <TurnoverCheck id="turnover-roots" label="Clear remaining roots and debris" />
        </div>
      </section>

      <section className={styles.nextBedPhase}>
        <header><span>Next for this bed</span></header>
        <div>
          <small>Phase</small>
          <strong>Fall cover crop</strong>
        </div>
        <div>
          <small>Target</small>
          <strong>Oct 20</strong>
        </div>
      </section>

      <footer className={styles.finish}>
        <span>Finish Turnover</span>
        <div>
          <button type="button" className={styles.primaryFinish}>Bed cleared + biomass moved</button>
          <button type="button">Blocked</button>
        </div>
      </footer>
    </article>
  );
}

export default function WeedCardSpecimen() {
  return (
    <div className={styles.weedSpecimen}>
      <WeedCard />
      <div className={styles.variantLabel}><span>Same bed shell · clear / turn over variant</span></div>
      <TurnoverCard />
    </div>
  );
}
