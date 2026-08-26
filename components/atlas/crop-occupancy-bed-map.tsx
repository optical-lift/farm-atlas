"use client";

import { useState, type FormEvent } from "react";

import { recordAtlasObservedCropPresence } from "@/lib/atlas/bed-crop-presence-client";
import type {
  AtlasBedMap,
  AtlasBedMapFeature,
  AtlasBedMapPlacement,
  AtlasMapEdge,
} from "@/lib/atlas/weed-card-contract";
import styles from "./crop-occupancy-bed-map.module.css";
import square from "./square-foot-bed-map.module.css";

type Props = {
  map: AtlasBedMap | null | undefined;
  variant?: "default" | "notebook";
};

function edgeLabel(edge: AtlasMapEdge | null | undefined) {
  return edge ? edge.slice(0, 1).toUpperCase() : "?";
}

function edgeName(edge: AtlasMapEdge | null | undefined) {
  return edge ?? "unknown";
}

function numberLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function establishmentDateLabel(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function quantityLabel(placement: AtlasBedMapPlacement) {
  if (placement.observedQuantity != null) {
    const unit = placement.observedQuantityUnit === "clumps"
      ? placement.observedQuantity === 1 ? "clump" : "clumps"
      : placement.observedQuantity === 1 ? "plant" : "plants";
    return `${numberLabel(placement.observedQuantity)} ${unit}`;
  }
  if (placement.explicitPlantCount != null) {
    return `${numberLabel(placement.explicitPlantCount)} ${placement.explicitPlantCount === 1 ? "plant" : "plants"}`;
  }
  if (placement.expectedQuantity != null && placement.expectedQuantityKind !== "unknown") {
    return `${placement.expectedQuantityKind === "calculated" ? "~" : ""}${numberLabel(placement.expectedQuantity)} expected`;
  }
  return null;
}

function placementText(placement: AtlasBedMapPlacement) {
  return [placement.displayLabel, quantityLabel(placement), establishmentDateLabel(placement.establishmentDate)]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function compactPlacementText(placement: AtlasBedMapPlacement) {
  const quantity = quantityLabel(placement);
  return [placement.displayLabel, quantity, establishmentDateLabel(placement.establishmentDate)]
    .filter((value): value is string => Boolean(value))
    .join("—");
}

function compactCropLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "forget-me-not" || normalized === "forget me not") return "FMN";
  if (normalized === "italian white sunflower") return "Italian White";
  return value;
}

function isRowPlacement(placement: AtlasBedMapPlacement) {
  return placement.placementMode === "full_rows" || placement.placementMode === "partial_rows";
}

function rowCount(placement: AtlasBedMapPlacement) {
  if (isRowPlacement(placement)) {
    return Math.max(1, Math.min(4, Math.round(placement.rowCount ?? 1)));
  }
  return 1;
}

function rowStyle(placement: AtlasBedMapPlacement, lengthFt: number | null) {
  if (!lengthFt || lengthFt <= 0) return undefined;

  const hasStart = placement.longStartFt != null;
  const hasEnd = placement.longEndFt != null;
  let start = placement.longStartFt ?? 0;
  let span = hasEnd
    ? Math.max(0.5, (placement.longEndFt ?? start + 0.5) - start)
    : placement.rowLengthFt ?? lengthFt;

  if (!hasStart && !hasEnd && !isRowPlacement(placement)) {
    if (placement.placementMode === "scattered") span = Math.max(4, lengthFt * 0.58);
    else span = Math.max(3, lengthFt * 0.26);
    start = Math.max(0, (lengthFt - span) / 2);
  }

  const startPercent = Math.max(0, Math.min(96, (start / lengthFt) * 100));
  const availablePercent = Math.max(4, 100 - startPercent);
  const widthPercent = Math.max(12, Math.min(availablePercent, (span / lengthFt) * 100));

  return {
    marginInlineStart: `${startPercent}%`,
    width: `${widthPercent}%`,
  };
}

function edgeBandBasis(placements: AtlasBedMapPlacement[], lengthFt: number | null) {
  if (!lengthFt || lengthFt <= 0) return 18;
  const knownSpans = placements
    .map((placement) => {
      if (placement.longStartFt == null || placement.longEndFt == null) return null;
      return Math.max(0, placement.longEndFt - placement.longStartFt);
    })
    .filter((value): value is number => value != null && value > 0);
  if (!knownSpans.length) return 18;
  return Math.max(10, Math.min(24, (Math.max(...knownSpans) / lengthFt) * 100));
}

function EdgeBand({ placements, edge, lengthFt }: { placements: AtlasBedMapPlacement[]; edge: "left" | "right"; lengthFt: number | null }) {
  if (!placements.length) return null;
  const names = Array.from(new Set(placements.map((placement) => compactCropLabel(placement.displayLabel))));
  const visibleText = placements.length === 1
    ? [compactCropLabel(placements[0].displayLabel), establishmentDateLabel(placements[0].establishmentDate)]
        .filter((value): value is string => Boolean(value))
        .join(" · ")
    : names.join(" · ");
  return (
    <div
      className={`${styles.edgeBand} ${edge === "left" ? styles.leftBand : styles.rightBand}`}
      style={{ flexBasis: `${edgeBandBasis(placements, lengthFt)}%` }}
      title={placements.map(placementText).join(" · ")}
    >
      <span>{visibleText}</span>
    </div>
  );
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function placementCoverageIsExact(placement: AtlasBedMapPlacement, lengthFt: number) {
  if (placement.longStartFt != null || placement.longEndFt != null) return true;
  if (placement.placementMode === "full_rows") return true;
  if (placement.rowLengthFt != null && placement.rowLengthFt >= lengthFt - 0.5) return true;
  return false;
}

function placementTouchesBlock(placement: AtlasBedMapPlacement, startFt: number, endFt: number, lengthFt: number) {
  if (placement.longStartFt != null || placement.longEndFt != null) {
    const start = placement.longStartFt ?? 0;
    const end = placement.longEndFt ?? Math.min(lengthFt, start + (placement.rowLengthFt ?? lengthFt));
    return start < endFt && end > startFt;
  }
  if (placement.placementMode === "full_rows") return true;
  if (placement.rowLengthFt != null && placement.rowLengthFt >= lengthFt - 0.5) return true;
  return true;
}

function featureCropLabels(feature: AtlasBedMapFeature) {
  return Array.from(new Set(feature.occupancyGroups.flatMap((group) => group.cohorts.map((cohort) => cohort.displayLabel))));
}

function InlineCropAdder({ map, onAdded }: { map: AtlasBedMap; onAdded: (label: string) => void }) {
  const [cropLabel, setCropLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = cropLabel.trim();
    if (!label || saving) return;
    try {
      setSaving(true);
      setMessage(null);
      const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await recordAtlasObservedCropPresence({
        objectKey: map.objectKey,
        cropLabel: label,
        observedDate: todayIso(),
        idempotencyKey: `bed-crop:${map.objectKey}:${nonce}`,
      });
      onAdded(result.cropLabel);
      setCropLabel("");
      setMessage(`${result.cropLabel} added`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Atlas could not add this crop.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={square.addCrop} onSubmit={(event) => void submit(event)} data-atlas-inline-crop-entry="true">
      <input
        value={cropLabel}
        disabled={saving}
        onChange={(event) => { setCropLabel(event.target.value); setMessage(null); }}
        placeholder="+ Add crop…"
        aria-label={`Add crop observed in ${map.objectLabel}`}
        maxLength={120}
      />
      {cropLabel.trim() ? <button type="submit" disabled={saving}>{saving ? "Adding…" : "Add"}</button> : null}
      {message ? <small role="status">{message}</small> : null}
    </form>
  );
}

function CompactSquareBedMap({ map, lengthFt, widthFt }: { map: AtlasBedMap; lengthFt: number; widthFt: number }) {
  const [addedLabels, setAddedLabels] = useState<string[]>([]);
  const cropLabels = Array.from(new Set([...map.placements.map((placement) => placement.displayLabel), ...addedLabels]));
  const leftFeatures = (map.features ?? []).filter((feature) => feature.mapSide === "left");
  const rightFeatures = (map.features ?? []).filter((feature) => feature.mapSide === "right");
  const dimensionLabel = `${Math.round(widthFt * 12)}\" × ${Math.round(lengthFt * 12)}\"`;

  function renderArch(features: AtlasBedMapFeature[], side: "left" | "right") {
    const arch = features.find((feature) => feature.featureKind === "arch");
    if (!arch) return <span className={square.featureSpacer} aria-hidden="true" />;
    const crops = featureCropLabels(arch);
    const description = [arch.featureLabel, crops.length ? crops.join(", ") : null].filter(Boolean).join(": ");
    return <div className={`${square.archFeature} ${side === "left" ? square.archLeft : square.archRight}`} aria-label={description} title={description} />;
  }

  return (
    <section className={square.root} data-atlas-square-foot-bed-map="compact-square-v2" aria-label={`Bed map for ${map.objectLabel}, ${dimensionLabel}.`}>
      <div className={square.compactGeometry}>
        {renderArch(leftFeatures, "left")}
        <div className={square.compactBedSquare}>
          <span className={square.dimensionTag}>{dimensionLabel}</span>
          <div className={square.compactCropList} aria-label="Crops currently recorded in this bed">
            {cropLabels.length ? cropLabels.map((label) => <span key={label}>{label}</span>) : <em>No crop recorded</em>}
          </div>
          <InlineCropAdder map={map} onAdded={(label) => setAddedLabels((current) => current.includes(label) ? current : [...current, label])} />
        </div>
        {renderArch(rightFeatures, "right")}
      </div>
    </section>
  );
}

function SquareFootBedMap({ map }: { map: AtlasBedMap }) {
  const lengthFt = map.lengthFt && map.lengthFt > 0 ? map.lengthFt : null;
  const widthFt = map.widthFt && map.widthFt > 0 ? map.widthFt : null;
  const [selectedBlock, setSelectedBlock] = useState(0);
  const [addedLabels, setAddedLabels] = useState<string[]>([]);

  if (!lengthFt || !widthFt) return null;

  const isCompactSquare = Math.abs(lengthFt - widthFt) <= 0.2 && Math.max(lengthFt, widthFt) <= 4.25;
  if (isCompactSquare) return <CompactSquareBedMap map={map} lengthFt={lengthFt} widthFt={widthFt} />;

  const blockFt = Math.min(3, lengthFt);
  const blocks = Array.from({ length: Math.ceil(lengthFt / blockFt) }, (_, index) => {
    const start = index * blockFt;
    return { start, end: Math.min(lengthFt, start + blockFt) };
  });
  const activeIndex = Math.min(selectedBlock, Math.max(0, blocks.length - 1));
  const activeBlock = blocks[activeIndex];
  const activePlacements = map.placements.filter((placement) => placementTouchesBlock(placement, activeBlock.start, activeBlock.end, lengthFt));
  const activeNames = Array.from(new Set([...activePlacements.map((placement) => placement.displayLabel), ...addedLabels]));
  const activeArea = Math.max(1, Math.round(widthFt * (activeBlock.end - activeBlock.start)));
  const widthCells = Math.max(1, Math.round(widthFt));
  const hasUncertainPlacement = activePlacements.some((placement) => !placementCoverageIsExact(placement, lengthFt));

  return (
    <section className={square.root} data-atlas-square-foot-bed-map="mockup-v2" aria-label={`Square-foot crop map for ${map.objectLabel}, ${numberLabel(widthFt)} feet by ${numberLabel(lengthFt)} feet.`}>
      <div className={square.bedRectangle} style={{ gridTemplateColumns: `repeat(${blocks.length}, minmax(0, 1fr))` }}>
        {blocks.map((block, blockIndex) => {
          const placements = map.placements.filter((placement) => placementTouchesBlock(placement, block.start, block.end, lengthFt));
          const exact = placements.some((placement) => placementCoverageIsExact(placement, lengthFt));
          const cells = Math.max(1, Math.round(widthFt * (block.end - block.start)));
          const mark = placements.length ? (exact ? "o" : "·") : "";
          const labels = Array.from(new Set(placements.map((placement) => placement.displayLabel)));
          return (
            <button type="button" className={blockIndex === activeIndex ? square.mapBlockActive : square.mapBlock} key={block.start} onClick={() => setSelectedBlock(blockIndex)} aria-label={`${numberLabel(block.start)} to ${numberLabel(block.end)} feet${labels.length ? `, ${labels.join(", ")}` : ", no mapped crop"}`} style={{ gridTemplateColumns: `repeat(${widthCells}, minmax(0, 1fr))` }}>
              {Array.from({ length: cells }, (_, squareIndex) => <span key={squareIndex}>{mark}</span>)}
            </button>
          );
        })}
        <div className={square.addCropWide}><InlineCropAdder map={map} onAdded={(label) => setAddedLabels((current) => current.includes(label) ? current : [...current, label])} /></div>
      </div>

      <div className={square.mapScale} aria-hidden="true"><span>0 ft</span><span>{numberLabel(lengthFt / 2)} ft</span><span>{numberLabel(lengthFt)} ft</span></div>
      <div className={square.mapDetail}>
        <span>{numberLabel(activeBlock.start)}–{numberLabel(activeBlock.end)} ft</span>
        <strong>{activeNames.length ? activeNames.join(" + ") : "No mapped crop"}</strong>
        <small>{activeArea} sq ft shown · tap another section to inspect it{hasUncertainPlacement ? " · dotted marks mean the exact position is not recorded" : ""}</small>
      </div>
      <div className={square.mapLegend}><code>o</code> crop square{hasUncertainPlacement ? <><code>·</code> position not precise</> : null}</div>
    </section>
  );
}

export default function CropOccupancyBedMap({ map, variant = "default" }: Props) {
  if (!map) return null;

  if (variant === "notebook" && map.lengthFt && map.widthFt) return <SquareFootBedMap map={map} />;

  const leftAnchored = map.placements.filter((placement) => placement.anchorEdge === map.leftEdge);
  const rightAnchored = map.placements.filter((placement) => placement.anchorEdge === map.rightEdge);
  const topAnchored = map.placements.filter((placement) => placement.anchorEdge === map.topEdge);
  const bottomAnchored = map.placements.filter((placement) => placement.anchorEdge === map.bottomEdge);
  const anchoredIds = new Set([...leftAnchored, ...rightAnchored, ...topAnchored, ...bottomAnchored].map((placement) => placement.placementId));
  const bodyPlacements = map.placements.filter((placement) => !anchoredIds.has(placement.placementId));
  const rowPlacements = bodyPlacements.filter(isRowPlacement);
  const loosePlacements = bodyPlacements.filter((placement) => !isRowPlacement(placement));
  const looseGroups = loosePlacements.length <= 3 ? loosePlacements.map((placement) => [placement]) : chunks(loosePlacements, 3);
  const orientationDescription = `${edgeName(map.leftEdge)} is left, ${edgeName(map.rightEdge)} is right, ${edgeName(map.topEdge)} is above, and ${edgeName(map.bottomEdge)} is below`;

  return (
    <section className={`${styles.root} ${map.orientationKnown ? "" : styles.unknownOrientation}`.trim()} aria-label={`Planting map for ${map.objectLabel}; ${orientationDescription}.`}>
      <div className={styles.bed}>
        <span className={`${styles.endDirection} ${styles.leftDirection}`} aria-hidden="true">{edgeLabel(map.leftEdge)}</span>
        <span className={`${styles.endDirection} ${styles.rightDirection}`} aria-hidden="true">{edgeLabel(map.rightEdge)}</span>
        {topAnchored.length ? <div className={`${styles.crossBand} ${styles.topBand}`}>{topAnchored.map((item) => item.displayLabel).join(" · ")}</div> : null}
        <div className={styles.bedBody}>
          <EdgeBand placements={leftAnchored} edge="left" lengthFt={map.lengthFt} />
          <div className={styles.rows}>
            {!rowPlacements.length && !looseGroups.length ? <div className={styles.emptyBed} aria-hidden="true">—</div> : null}
            {rowPlacements.map((placement) => {
              const count = rowCount(placement);
              const uncertain = placement.positionConfidence === "unknown" || placement.positionConfidence === "low";
              return Array.from({ length: count }, (_, index) => (
                <div className={`${styles.row} ${uncertain ? styles.uncertain : ""}`.trim()} key={`${placement.placementId}:${index}`} style={rowStyle(placement, map.lengthFt)}>
                  <i aria-hidden="true" />
                  {index === Math.floor(count / 2) ? <span>{placementText(placement)}</span> : <span aria-hidden="true">&nbsp;</span>}
                  <i aria-hidden="true" />
                </div>
              ));
            })}
            {looseGroups.map((group, index) => {
              const placement = group[0];
              const uncertain = group.length > 1 || placement.positionConfidence === "unknown" || placement.positionConfidence === "low";
              const text = group.length === 1 ? placementText(placement) : group.map(compactPlacementText).join(" · ");
              return (
                <div className={`${styles.row} ${styles.looseRow} ${uncertain ? styles.uncertain : ""}`.trim()} key={`loose:${group.map((item) => item.placementId).join(":")}:${index}`} style={group.length === 1 ? rowStyle(placement, map.lengthFt) : undefined}>
                  <i aria-hidden="true" /><span>{text}</span><i aria-hidden="true" />
                </div>
              );
            })}
          </div>
          <EdgeBand placements={rightAnchored} edge="right" lengthFt={map.lengthFt} />
        </div>
        {bottomAnchored.length ? <div className={`${styles.crossBand} ${styles.bottomBand}`}>{bottomAnchored.map((item) => item.displayLabel).join(" · ")}</div> : null}
      </div>
    </section>
  );
}