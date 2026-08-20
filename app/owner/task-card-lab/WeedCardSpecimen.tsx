"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import DominionCardFrame from "./DominionCardFrame";
import styles from "./weed-card-specimen.module.css";
import extras from "./weed-turnover-additions.module.css";
import variants from "./crop-cycle-bed-variants.module.css";

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

const irrigationTrail = [
  { label: "Sown", detail: "Aug 16 · Orange", state: "done" },
  { label: "Irrigate", detail: "care pulse", state: "now" },
  { label: "Germination", detail: "Aug 20–26", state: "later" },
  { label: "Tend", detail: "protect crop", state: "later" },
  { label: "Harvest", detail: "Oct 4–14", state: "later" },
] as const;

const germinationTrail = [
  { label: "Sown", detail: "Aug 16 · Orange", state: "done" },
  { label: "Germination", detail: "check stand", state: "now" },
  { label: "Next move", detail: "from result", state: "later" },
  { label: "Tend", detail: "protect crop", state: "later" },
  { label: "Harvest", detail: "Oct 4–14", state: "later" },
] as const;

const turnoverTrail = [
  { label: "Sown", detail: "Jun 7 · black oil", state: "done" },
  { label: "Harvest", detail: "Aug 1–6", state: "done" },
  { label: "Turn over", detail: "after harvest", state: "now" },
  { label: "Sow", detail: "Aug 16 · Orange", state: "later" },
  { label: "Harvest", detail: "Oct 4–14", state: "later" },
] as const;

type TrailStep = {
  label: string;
  detail: string;
  state: string;
};

const turnoverCategories = [
  { title: "Clear", items: ["Cut at soil level", "Take to compost"] },
  { title: "Weed", items: ["Remove roots", "Take to compost"] },
  { title: "Amend", items: ["Add available inputs"], availability: "No inputs available" },
] as const;

const harvestTaskHistory = [
  { date: "Aug 3", detail: "2 harvest-watch tasks" },
  { date: "Aug 5", detail: "1 harvest-watch task" },
] as const;

const mapBlocks = Array.from({ length: BED_LENGTH_FT / MAP_BLOCK_FT }, (_, index) => ({
  start: index * MAP_BLOCK_FT,
  end: (index + 1) * MAP_BLOCK_FT,
}));

function dayDiff(from: Date, to: Date) {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

function Trail({ steps, label }: { steps: readonly TrailStep[]; label: string }) {
  return (
    <div className={styles.trail} aria-label={label}>
      {steps.map((step) => (
        <span className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater} key={`${step.label}-${step.detail}`}>
          <b>{step.label}</b>
          <small>{step.detail}</small>
        </span>
      ))}
    </div>
  );
}

function CropCycleBedCard({
  family,
  familyDetail,
  timing,
  trail,
  trailLabel,
  crop,
  stage,
  harvest,
  children,
}: {
  family: string;
  familyDetail: string;
  timing: string;
  trail: readonly TrailStep[];
  trailLabel: string;
  crop: string;
  stage: string;
  harvest: string;
  children: ReactNode;
}) {
  return (
    <DominionCardFrame family={family} familyDetail={familyDetail} title="Field Row 13" subtitle="Field Rows" timing={timing}>
      <Trail steps={trail} label={trailLabel} />
      <section className={styles.cropState}>
        <span>Bed now</span>
        <strong>{crop}</strong>
        <div><b>{stage}</b><b>{harvest}</b></div>
      </section>
      {children}
    </DominionCardFrame>
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
        <button type="button">Save log</button>
      </div>
    </details>
  );
}

function BedMap({ cropLabel, logChoices = ["Deer damage", "Crop missing", "Extra weedy", "Other"] }: { cropLabel: string; logChoices?: string[] }) {
  const [selectedBlock, setSelectedBlock] = useState(0);
  const [logMode, setLogMode] = useState(false);
  const [loggedBlocks, setLoggedBlocks] = useState<number[]>([0]);
  const activeBlock = mapBlocks[selectedBlock];
  const selected = logMode ? loggedBlocks : [selectedBlock];
  const selectedSorted = [...selected].sort((a, b) => a - b);
  const first = mapBlocks[selectedSorted[0] ?? 0];
  const last = mapBlocks[selectedSorted[selectedSorted.length - 1] ?? 0];
  const contiguous = selectedSorted.every((value, index) => index === 0 || value === selectedSorted[index - 1] + 1);
  const selectionLabel = contiguous ? `${first.start}–${last.end} ft` : `${selectedSorted.length} sections`;
  const selectedSqFt = selectedSorted.length * BED_WIDTH_FT * MAP_BLOCK_FT;

  function selectBlock(blockIndex: number) {
    if (!logMode) {
      setSelectedBlock(blockIndex);
      setLoggedBlocks([blockIndex]);
      return;
    }
    setLoggedBlocks((current) => {
      if (current.includes(blockIndex)) return current.length === 1 ? current : current.filter((index) => index !== blockIndex);
      return [...current, blockIndex];
    });
  }

  function toggleLogMode() {
    if (!logMode) setLoggedBlocks([selectedBlock]);
    setLogMode((current) => !current);
  }

  return (
    <section className={styles.bedMap}>
      <header><span>Bed map</span><small>{BED_WIDTH_FT} ft × {BED_LENGTH_FT} ft</small></header>
      <div className={extras.mapOrientation}>↑ back fence this side</div>
      <div className={styles.bedRectangle} aria-label={`Square-foot crop map for ${cropLabel}`}>
        {mapBlocks.map((block, blockIndex) => {
          const selectedForLog = logMode && loggedBlocks.includes(blockIndex);
          const inspected = !logMode && blockIndex === selectedBlock;
          return (
            <button type="button" className={selectedForLog || inspected ? styles.mapBlockActive : styles.mapBlock} key={block.start} onClick={() => selectBlock(blockIndex)} aria-label={`Feet ${block.start} to ${block.end}, ${cropLabel}`}>
              {Array.from({ length: BED_WIDTH_FT * MAP_BLOCK_FT }, (_, squareIndex) => <span key={squareIndex}>o</span>)}
            </button>
          );
        })}
      </div>
      <div className={styles.mapScale} aria-hidden="true"><span>0 ft</span><span>15 ft</span><span>30 ft</span></div>
      <div className={`${styles.mapDetail} ${extras.mapDetailWithLog}`}>
        <span>{logMode ? selectionLabel : `${activeBlock.start}–${activeBlock.end} ft`}</span>
        <strong>{cropLabel}</strong>
        <button type="button" className={extras.mapLogButton} onClick={toggleLogMode}>{logMode ? "Done" : "Log"}</button>
        <small>{logMode ? `${selectedSqFt} sq ft selected · tap neighboring sections to add or remove them` : `${BED_WIDTH_FT * MAP_BLOCK_FT} sq ft shown · tap another section to inspect it`}</small>
        {logMode ? (
          <div className={extras.mapLogPanel}>
            <div className={extras.mapLogPills}>
              {logChoices.map((choice) => <button type="button" key={choice}>{choice}</button>)}
            </div>
            <div className={extras.mapLogNote}>
              <input type="text" placeholder="Add note…" aria-label="Add a bed-section note" />
              <button type="button">Save log</button>
            </div>
          </div>
        ) : null}
      </div>
      <div className={styles.mapLegend}><code>o</code> sunflower square</div>
    </section>
  );
}

function CropIssueDrawer({ label, choices }: { label: string; choices: string[] }) {
  return (
    <details className={variants.issueDrawer}>
      <summary aria-label={`Log an issue with ${label}`} title={`Log an issue with ${label}`}><span aria-hidden="true">+</span></summary>
      <div className={variants.issuePanel}>
        {choices.map((choice) => <button type="button" key={choice}>{choice}</button>)}
      </div>
    </details>
  );
}

function WeedCard() {
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => { setToday(new Date()); }, []);
  const cropTiming = useMemo(() => {
    if (!today) return { stage: "Updating…", harvest: "Updating…" };
    const day = dayDiff(SOWN_ON, today);
    const toHarvestStart = Math.round((HARVEST_START.getTime() - today.getTime()) / 86_400_000);
    const toHarvestEnd = Math.round((HARVEST_END.getTime() - today.getTime()) / 86_400_000);
    let harvest = "Harvest watch now";
    if (toHarvestEnd < 0) harvest = "Harvest window passed";
    else if (toHarvestStart > 0) harvest = `${toHarvestStart}–${toHarvestEnd} days to harvest watch`;
    return { stage: `Day ${day} since sowing`, harvest };
  }, [today]);

  return (
    <CropCycleBedCard family="Weed" familyDetail="bed care" timing="Today · weeding due" trail={weedTrail} trailLabel="Field Row 13 crop-cycle trail" crop="ProCut Orange sunflower" stage={cropTiming.stage} harvest={cropTiming.harvest}>
      <BedMap cropLabel="ProCut Orange sunflower" />
      <section className={styles.results}>
        <header><span>How’d we do?</span></header>
        <div className={styles.resultPills}>
          <ResultPill label="Still rough" /><ResultPill label="Crop readable" /><ResultPill label="Clear" /><LogItDrawer />
        </div>
      </section>
    </CropCycleBedCard>
  );
}

function IrrigationCard() {
  return (
    <CropCycleBedCard family="Irrigation" familyDetail="care pulse" timing="Germination window · irrigate" trail={irrigationTrail} trailLabel="Field Row 13 crop-cycle trail with irrigation care pulse" crop="ProCut Orange sunflower" stage="Germination window" harvest="Harvest watch Oct 4–14">
      <BedMap cropLabel="ProCut Orange sunflower" logChoices={["Dry section", "Runoff", "Crop stress", "Other"]} />
      <section className={variants.careSection}>
        <div className={variants.careFacts}>
          <div><small>Method</small><strong>Hose line</strong></div>
          <div><small>Enough</small><strong>Evenly moist</strong></div>
        </div>
        <div className={variants.resourceRow}>
          <div><span>Water source</span><strong>Field Rows hose line</strong><small>Available</small></div>
          <CropIssueDrawer label="Field Rows hose line" choices={["Won't run", "Leak", "Low pressure", "Other"]} />
        </div>
      </section>
    </CropCycleBedCard>
  );
}

type GerminationChoice = "Strong" | "Patchy" | "Failed" | "Too early to tell";

const germinationNext: Record<GerminationChoice, string> = {
  Strong: "Continue",
  Patchy: "Gap fill",
  Failed: "Restart",
  "Too early to tell": "Wait",
};

function GerminationCard() {
  const [choice, setChoice] = useState<GerminationChoice | null>(null);
  const trail = germinationTrail.map((step) => step.label === "Next move" && choice ? { ...step, detail: germinationNext[choice] } : step);

  return (
    <CropCycleBedCard family="Check" familyDetail="crop check" timing="Germination window · check stand" trail={trail} trailLabel="Field Row 13 crop-cycle germination trail" crop="ProCut Orange sunflower" stage="Day 4 since sowing" harvest="Harvest watch Oct 4–14">
      <BedMap cropLabel="ProCut Orange sunflower" logChoices={["Patchy", "Crop missing", "Late emergence", "Other"]} />
      <section className={variants.checkSection}>
        <div className={variants.checkPrompt}>Did enough emerge to keep this planting?</div>
        <div className={variants.checkChoices}>
          {(Object.keys(germinationNext) as GerminationChoice[]).map((item) => (
            <button type="button" data-active={choice === item ? "true" : "false"} key={item} onClick={() => setChoice(item)}>{item}</button>
          ))}
        </div>
        {choice ? <div className={variants.nextMove}><small>Next</small><strong>{germinationNext[choice]}</strong></div> : null}
      </section>
    </CropCycleBedCard>
  );
}

function TurnoverReminder({ id, label }: { id: string; label: string }) {
  return <div className={extras.turnoverReminderRow}><input id={id} type="checkbox" /><label htmlFor={id}><strong>{label}</strong></label></div>;
}

function TurnoverCategory({ title, items, availability, prefix }: { title: string; items: readonly string[]; availability?: string; prefix: string }) {
  return (
    <section className={extras.turnoverCategory}>
      <header><h3>{title}</h3></header>
      <div className={extras.turnoverCategoryRail}>
        {items.map((item, index) => <TurnoverReminder id={`${prefix}-${index}`} label={item} key={item} />)}
      </div>
      {availability ? <div className={extras.turnoverAvailability}>{availability}</div> : null}
    </section>
  );
}

function TurnoverCard() {
  return (
    <CropCycleBedCard family="Clear / Turn over" familyDetail="bed turnover" timing="After harvest · turnover due" trail={turnoverTrail} trailLabel="Field Row 13 crop-cycle turnover trail" crop="Black oil sunflower" stage="Harvest window Aug 1–6" harvest="Next sowing Aug 16">
      <BedMap cropLabel="Black oil sunflower" />
      <section className={extras.turnoverMethod}>
        <div className={extras.turnoverMethodKey}>tap to cross off</div>
        {turnoverCategories.map((category) => <TurnoverCategory title={category.title} items={category.items} availability={"availability" in category ? category.availability : undefined} prefix={`turnover-${category.title.toLowerCase()}`} key={category.title} />)}
      </section>
      <section className={extras.harvestHistory}>
        <header><span>Harvest</span></header>
        <div className={extras.harvestSummary}>
          <div><small>Recorded harvest</small><strong>None logged</strong></div>
          <div><small>Harvest-window tasks</small><strong>3</strong></div>
        </div>
        <div className={extras.harvestTaskList}>
          {harvestTaskHistory.map((item) => <div key={`${item.date}-${item.detail}`}><span>{item.date}</span><strong>{item.detail}</strong></div>)}
        </div>
      </section>
    </CropCycleBedCard>
  );
}

export default function WeedCardSpecimen() {
  return (
    <div className={extras.weedSpecimen}>
      <WeedCard />
      <div className={extras.variantLabel}><span>Same crop-cycle bed shell · irrigation care pulse</span></div>
      <IrrigationCard />
      <div className={extras.variantLabel}><span>Same crop-cycle bed shell · germination observation</span></div>
      <GerminationCard />
      <div className={extras.variantLabel}><span>Same crop-cycle bed shell · clear / turn over variant</span></div>
      <TurnoverCard />
    </div>
  );
}
