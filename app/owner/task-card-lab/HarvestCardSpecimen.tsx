"use client";

import { useMemo, useState, type CSSProperties } from "react";

import DominionCardFrame from "./DominionCardFrame";
import styles from "./harvest-card-specimen.module.css";

type HarvestOutcome = "nothing_ready" | "deadheaded" | "crop_exhausted";
type IntakeSource = "Foraged" | "Purchased" | "Gifted";
type IntakeUnit = "Stems" | "Buckets" | "Bundles";

type HarvestCrop = {
  id: string;
  zone: string;
  bed: string;
  crop: string;
};

type ExternalIntakeLine = {
  id: string;
  flower: string;
  color: string;
  unit: IntakeUnit;
  quantity: number;
};

const seasonPulse = [
  { label: "Last round", detail: "6 crops · 7½ buckets", state: "done" },
  { label: "This round", detail: "4 crops ready", state: "now" },
  { label: "Next watch", detail: "3 crops", state: "later" },
] as const;

const crops: HarvestCrop[] = [
  { id: "bw5-white-lite", zone: "Berry Walk", bed: "BW5", crop: "White Lite sunflower" },
  { id: "bw7-italian-white", zone: "Berry Walk", bed: "BW7", crop: "Italian White sunflower" },
  { id: "fr2-zinnia", zone: "Field Rows", bed: "FR2", crop: "Zinnia mix" },
  { id: "fr15-italian-white", zone: "Field Rows", bed: "FR15", crop: "Italian White sunflower" },
];

const outcomeChoices: Array<{ value: HarvestOutcome; label: string }> = [
  { value: "nothing_ready", label: "Nothing ready" },
  { value: "deadheaded", label: "Deadheaded" },
  { value: "crop_exhausted", label: "Crop exhausted" },
];

const sourceChoices: IntakeSource[] = ["Foraged", "Purchased", "Gifted"];
const unitChoices: IntakeUnit[] = ["Stems", "Buckets", "Bundles"];

const intakeUi: Record<string, CSSProperties> = {
  launch: {
    display: "grid",
    gap: 10,
    padding: "14px 18px 16px",
    borderBottom: "1px solid rgba(215, 204, 189, 0.62)",
    background: "rgba(246, 242, 230, 0.32)",
  },
  launchCopy: { display: "grid", gap: 4, minWidth: 0 },
  kicker: {
    color: "#858bb8",
    fontSize: 9,
    lineHeight: 1,
    fontWeight: 950,
    letterSpacing: "0.11em",
    textTransform: "uppercase",
  },
  launchTitle: { color: "#666960", fontSize: 12, lineHeight: 1.25, fontWeight: 900 },
  launchButton: {
    width: "100%",
    minHeight: 44,
    border: "1px solid rgba(133, 139, 184, 0.28)",
    borderRadius: 14,
    background: "rgba(239, 237, 244, 0.76)",
    color: "#565b79",
    padding: "10px 13px",
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 930,
    textAlign: "left",
  },
  drawer: {
    display: "grid",
    borderBottom: "1px solid rgba(215, 204, 189, 0.62)",
    background: "rgba(252, 250, 244, 0.98)",
  },
  drawerHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: "15px 18px 12px",
  },
  drawerHeadCopy: { display: "grid", gap: 4, minWidth: 0 },
  drawerTitle: { color: "#666960", fontSize: 11, lineHeight: 1.25, fontWeight: 900 },
  textButton: {
    border: 0,
    background: "transparent",
    color: "#72778f",
    padding: "2px 0",
    fontSize: 9,
    lineHeight: 1,
    fontWeight: 900,
  },
  builder: {
    display: "grid",
    gap: 15,
    padding: "14px 18px 18px",
    borderTop: "1px solid rgba(223, 215, 202, 0.48)",
  },
  sentence: {
    padding: "11px 12px",
    borderRadius: 13,
    background: "rgba(239, 237, 244, 0.52)",
    color: "#565b72",
    fontSize: 10,
    lineHeight: 1.4,
    fontWeight: 850,
    overflowWrap: "anywhere",
  },
  step: { display: "grid", gap: 8 },
  stepLabel: {
    color: "#858bb8",
    fontSize: 9,
    lineHeight: 1,
    fontWeight: 950,
    letterSpacing: "0.09em",
    textTransform: "uppercase",
  },
  pills: { display: "flex", flexWrap: "wrap", gap: 6 },
  pill: {
    minHeight: 32,
    border: "1px solid rgba(139, 145, 194, 0.18)",
    borderRadius: 999,
    background: "rgba(250, 248, 239, 0.92)",
    color: "#686a73",
    padding: "7px 10px",
    fontSize: 9,
    lineHeight: 1,
    fontWeight: 880,
  },
  pillActive: {
    border: "1px solid rgba(111, 118, 158, 0.52)",
    background: "rgba(232, 232, 241, 0.94)",
    color: "#4f5268",
  },
  field: { display: "grid", gap: 7 },
  input: {
    width: "100%",
    minWidth: 0,
    minHeight: 41,
    boxSizing: "border-box",
    border: "1px solid rgba(121, 109, 89, 0.19)",
    borderRadius: 11,
    background: "rgba(255,255,255,.96)",
    color: "#303243",
    padding: "8px 10px",
    fontSize: 16,
    lineHeight: 1.1,
    fontWeight: 820,
  },
  composer: {
    display: "grid",
    gap: 11,
    padding: "12px",
    border: "1px solid rgba(223, 215, 202, 0.7)",
    borderRadius: 15,
    background: "rgba(255,255,255,.58)",
  },
  composerFields: {
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    gap: 8,
  },
  addLineButton: {
    width: "100%",
    minHeight: 42,
    border: "1px solid rgba(111,118,158,.28)",
    borderRadius: 13,
    background: "rgba(239,237,244,.76)",
    color: "#565b79",
    padding: "9px 12px",
    fontSize: 10,
    lineHeight: 1,
    fontWeight: 930,
  },
  intakeRows: {
    display: "grid",
    borderTop: "1px solid rgba(223,215,202,.55)",
  },
  intakeRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) auto",
    gap: 10,
    alignItems: "center",
    padding: "12px 0",
    borderBottom: "1px solid rgba(223,215,202,.48)",
  },
  intakeIdentity: { minWidth: 0, display: "grid", gap: 4 },
  intakeFlower: { color: "#303243", fontSize: 13, lineHeight: 1.12, fontWeight: 930 },
  intakeMeta: { color: "#8f9089", fontSize: 9, lineHeight: 1.15, fontWeight: 800 },
  removeLine: {
    width: "fit-content",
    border: 0,
    background: "transparent",
    color: "#96978f",
    padding: 0,
    fontSize: 8,
    lineHeight: 1,
    fontWeight: 850,
  },
  counter: { display: "flex", alignItems: "center", gap: 4 },
  counterButton: {
    width: 30,
    height: 34,
    border: 0,
    background: "transparent",
    color: "#67655e",
    padding: 0,
    fontSize: 22,
    lineHeight: 1,
    fontWeight: 600,
  },
  counterValue: {
    display: "grid",
    placeItems: "center",
    minWidth: 40,
    height: 34,
    border: "1px solid rgba(121,109,89,.22)",
    borderRadius: 9,
    background: "#fff",
    color: "#303243",
    fontSize: 13,
    lineHeight: 1,
    fontWeight: 950,
  },
  counterUnit: { marginLeft: 5, color: "#92938c", fontSize: 9, lineHeight: 1, fontWeight: 800 },
  saveButton: {
    width: "100%",
    minHeight: 46,
    border: 0,
    borderRadius: 15,
    background: "rgba(214, 225, 177, 0.78)",
    color: "#515b34",
    padding: "10px 12px",
    fontSize: 11,
    lineHeight: 1,
    fontWeight: 930,
  },
  saved: { display: "grid", gap: 8, padding: "14px 18px 18px", borderTop: "1px solid rgba(223,215,202,.48)" },
  savedSentence: { color: "#303243", fontSize: 11, lineHeight: 1.4, fontWeight: 900 },
};

function formatBuckets(bucketHalves: number) {
  const buckets = bucketHalves / 2;
  return Number.isInteger(buckets) ? `${buckets}` : `${Math.floor(buckets)}½`.replace("0½", "½");
}

function unitLabel(unit: IntakeUnit) {
  return unit.toLowerCase();
}

function CropRow({ crop }: { crop: HarvestCrop }) {
  const [bucketHalves, setBucketHalves] = useState(0);
  const [outcome, setOutcome] = useState<HarvestOutcome | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function chooseOutcome(next: HarvestOutcome) {
    setOutcome(next);
    setBucketHalves(0);
  }

  function changeBucketCount(delta: number) {
    setOutcome(null);
    setBucketHalves((current) => Math.max(0, current + delta));
  }

  return (
    <div className={styles.cropRow} data-open={drawerOpen ? "true" : "false"}>
      <button type="button" className={styles.cropIdentity} aria-expanded={drawerOpen} aria-controls={`harvest-outcomes-${crop.id}`} onClick={() => setDrawerOpen((current) => !current)}>
        <span className={styles.cropText}><strong>{crop.crop}</strong><small>{crop.bed}</small></span>
      </button>

      <div className={styles.bucketCounter} aria-label={`${crop.crop} bucket count`}>
        <button type="button" aria-label={`Remove half bucket from ${crop.crop}`} disabled={bucketHalves === 0} onClick={() => changeBucketCount(-1)}>−</button>
        <strong>{formatBuckets(bucketHalves)}</strong>
        <button type="button" aria-label={`Add half bucket to ${crop.crop}`} onClick={() => changeBucketCount(1)}>+</button>
      </div>

      {drawerOpen ? (
        <div className={styles.exceptionPanel} id={`harvest-outcomes-${crop.id}`}>
          <span>What happened?</span>
          <div className={styles.outcomeGrid}>
            {outcomeChoices.map((choice) => (
              <button type="button" data-active={outcome === choice.value ? "true" : "false"} key={choice.value} onClick={() => chooseOutcome(choice.value)}>{choice.label}</button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Pill({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return <button type="button" style={{ ...intakeUi.pill, ...(active ? intakeUi.pillActive : {}) }} onClick={onClick}>{children}</button>;
}

function IntakeCounter({ value, unit, onChange }: { value: number; unit: string; onChange: (next: number) => void }) {
  return (
    <div style={intakeUi.counter}>
      <button type="button" style={{ ...intakeUi.counterButton, opacity: value === 0 ? .25 : 1 }} disabled={value === 0} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <strong style={intakeUi.counterValue}>{value}</strong>
      <button type="button" style={intakeUi.counterButton} onClick={() => onChange(value + 1)}>+</button>
      <small style={intakeUi.counterUnit}>{unit}</small>
    </div>
  );
}

function ExternalIntakeBuilder({ onClose }: { onClose: () => void }) {
  const [sourceType, setSourceType] = useState<IntakeSource>("Gifted");
  const [sourceLabel, setSourceLabel] = useState("Mary’s garden");
  const [flowerDraft, setFlowerDraft] = useState("");
  const [colorDraft, setColorDraft] = useState("");
  const [unitDraft, setUnitDraft] = useState<IntakeUnit>("Stems");
  const [lines, setLines] = useState<ExternalIntakeLine[]>([
    { id: "zinnia-pink", flower: "Zinnias", color: "pink", unit: "Buckets", quantity: 1 },
    { id: "marigold-orange", flower: "Marigolds", color: "orange", unit: "Buckets", quantity: 1 },
  ]);
  const [saved, setSaved] = useState(false);

  function addLine() {
    const flower = flowerDraft.trim();
    const color = colorDraft.trim();
    if (!flower || !color) return;

    setLines((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        flower,
        color,
        unit: unitDraft,
        quantity: 0,
      },
    ]);
    setFlowerDraft("");
    setColorDraft("");
  }

  function changeLineQuantity(id: string, delta: number) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, quantity: Math.max(0, line.quantity + delta) } : line));
  }

  const sentence = useMemo(() => {
    const items = lines.length
      ? lines.map((line) => `${line.flower} · ${line.color} · ${line.quantity} ${unitLabel(line.unit)}`).join("  |  ")
      : "no crop lines yet";
    return `${sourceType} · ${sourceLabel.trim() || "source unknown"} · ${items}`;
  }, [sourceType, sourceLabel, lines]);

  return (
    <section style={intakeUi.drawer} aria-label="External flower intake builder">
      <div style={intakeUi.drawerHead}>
        <div style={intakeUi.drawerHeadCopy}><span style={intakeUi.kicker}>External intake</span><strong style={intakeUi.drawerTitle}>Add flowers that did not come from an Elm bed</strong></div>
        <button type="button" style={intakeUi.textButton} onClick={onClose}>Close</button>
      </div>

      {saved ? (
        <div style={intakeUi.saved}>
          <span style={intakeUi.kicker}>Added to today’s flower custody</span>
          <strong style={intakeUi.savedSentence}>{sentence}</strong>
          <button type="button" style={intakeUi.textButton} onClick={() => setSaved(false)}>Edit</button>
        </div>
      ) : (
        <div style={intakeUi.builder}>
          <div style={intakeUi.sentence}>{sentence}</div>

          <div style={intakeUi.step}>
            <span style={intakeUi.stepLabel}>How did these come in?</span>
            <div style={intakeUi.pills}>{sourceChoices.map((choice) => <Pill active={sourceType === choice} key={choice} onClick={() => setSourceType(choice)}>{choice}</Pill>)}</div>
          </div>

          <label style={intakeUi.field}>
            <span style={intakeUi.stepLabel}>Source / place</span>
            <input style={intakeUi.input} value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} placeholder="Roadside, Mary’s garden, wholesaler…" />
          </label>

          <div style={intakeUi.step}>
            <span style={intakeUi.stepLabel}>What came in?</span>
            <div style={intakeUi.composer}>
              <div style={intakeUi.composerFields}>
                <label style={intakeUi.field}>
                  <span style={intakeUi.stepLabel}>Flower</span>
                  <input style={intakeUi.input} value={flowerDraft} onChange={(event) => setFlowerDraft(event.target.value)} placeholder="Dahlia" />
                </label>
                <label style={intakeUi.field}>
                  <span style={intakeUi.stepLabel}>Color</span>
                  <input style={intakeUi.input} value={colorDraft} onChange={(event) => setColorDraft(event.target.value)} placeholder="pink + white" />
                </label>
              </div>

              <div style={intakeUi.step}>
                <span style={intakeUi.stepLabel}>Count by</span>
                <div style={intakeUi.pills}>{unitChoices.map((choice) => <Pill active={unitDraft === choice} key={choice} onClick={() => setUnitDraft(choice)}>{choice}</Pill>)}</div>
              </div>

              <button
                type="button"
                style={{ ...intakeUi.addLineButton, opacity: flowerDraft.trim() && colorDraft.trim() ? 1 : .38 }}
                disabled={!flowerDraft.trim() || !colorDraft.trim()}
                onClick={addLine}
              >
                + Add flower
              </button>
            </div>
          </div>

          {lines.length ? (
            <div style={intakeUi.intakeRows}>
              {lines.map((line) => (
                <div style={intakeUi.intakeRow} key={line.id}>
                  <div style={intakeUi.intakeIdentity}>
                    <strong style={intakeUi.intakeFlower}>{line.color} {line.flower}</strong>
                    <small style={intakeUi.intakeMeta}>{sourceLabel.trim() || "source unknown"} · count by {unitLabel(line.unit)}</small>
                    <button type="button" style={intakeUi.removeLine} onClick={() => setLines((current) => current.filter((candidate) => candidate.id !== line.id))}>Remove</button>
                  </div>
                  <IntakeCounter value={line.quantity} unit={unitLabel(line.unit)} onChange={(next) => changeLineQuantity(line.id, next - line.quantity)} />
                </div>
              ))}
            </div>
          ) : null}

          <button type="button" style={intakeUi.saveButton} disabled={!lines.length} onClick={() => setSaved(true)}>Add to harvest custody</button>
        </div>
      )}
    </section>
  );
}

export default function HarvestCardSpecimen() {
  const zones = [...new Set(crops.map((crop) => crop.zone))];
  const [externalOpen, setExternalOpen] = useState(false);

  return (
    <DominionCardFrame family="Harvest" title="Harvest Stems" subtitle={zones.join(" · ")}>
      <div className={styles.trail} aria-label="Harvest season pulse">
        {seasonPulse.map((step) => (
          <span className={step.state === "done" ? styles.trailDone : step.state === "now" ? styles.trailNow : styles.trailLater} key={step.label}>
            <b>{step.label}</b><small>{step.detail}</small>
          </span>
        ))}
      </div>

      <div className={styles.harvestList}>
        <div className={styles.listKey}><span>Ready to harvest</span><small>½ bucket · 10 stems</small></div>
        {zones.map((zone) => (
          <section className={styles.zone} key={zone}>
            <header><h3>{zone}</h3></header>
            <div className={styles.zoneRows}>
              {crops.filter((crop) => crop.zone === zone).map((crop) => <CropRow crop={crop} key={crop.id} />)}
            </div>
          </section>
        ))}
      </div>

      <div style={intakeUi.launch}>
        <div style={intakeUi.launchCopy}>
          <span style={intakeUi.kicker}>External intake</span>
          <strong style={intakeUi.launchTitle}>Add flowers that did not come from an Elm bed</strong>
        </div>
        <button type="button" style={intakeUi.launchButton} aria-expanded={externalOpen} onClick={() => setExternalOpen((current) => !current)}>
          {externalOpen ? "Close external intake" : "Log external intake"}
        </button>
      </div>

      {externalOpen ? <ExternalIntakeBuilder onClose={() => setExternalOpen(false)} /> : null}
    </DominionCardFrame>
  );
}
