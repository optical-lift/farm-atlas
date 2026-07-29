"use client";

import type {
  AtlasBedMap,
  AtlasBedMapPlacement,
  AtlasMapEdge,
} from "@/lib/atlas/weed-card-contract";
import styles from "./crop-occupancy-bed-map.module.css";

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

export default function CropOccupancyBedMap({ map, variant = "default" }: Props) {
  if (!map) return null;

  const leftAnchored = map.placements.filter((placement) => placement.anchorEdge === map.leftEdge);
  const rightAnchored = map.placements.filter((placement) => placement.anchorEdge === map.rightEdge);
  const topAnchored = map.placements.filter((placement) => placement.anchorEdge === map.topEdge);
  const bottomAnchored = map.placements.filter((placement) => placement.anchorEdge === map.bottomEdge);
  const anchoredIds = new Set([...leftAnchored, ...rightAnchored, ...topAnchored, ...bottomAnchored].map((placement) => placement.placementId));
  const bodyPlacements = map.placements.filter((placement) => !anchoredIds.has(placement.placementId));
  const rowPlacements = bodyPlacements.filter(isRowPlacement);
  const loosePlacements = bodyPlacements.filter((placement) => !isRowPlacement(placement));
  const looseGroups = loosePlacements.length <= 3
    ? loosePlacements.map((placement) => [placement])
    : chunks(loosePlacements, 3);
  const orientationDescription = `${edgeName(map.leftEdge)} is left, ${edgeName(map.rightEdge)} is right, ${edgeName(map.topEdge)} is above, and ${edgeName(map.bottomEdge)} is below`;

  return (
    <section
      className={`${styles.root} ${variant === "notebook" ? styles.notebook : ""} ${map.orientationKnown ? "" : styles.unknownOrientation}`.trim()}
      aria-label={`Planting map for ${map.objectLabel}; ${orientationDescription}.`}
    >
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
                <div
                  className={`${styles.row} ${uncertain ? styles.uncertain : ""}`.trim()}
                  key={`${placement.placementId}:${index}`}
                  style={rowStyle(placement, map.lengthFt)}
                >
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
                <div
                  className={`${styles.row} ${styles.looseRow} ${uncertain ? styles.uncertain : ""}`.trim()}
                  key={`loose:${group.map((item) => item.placementId).join(":")}:${index}`}
                  style={group.length === 1 ? rowStyle(placement, map.lengthFt) : undefined}
                >
                  <i aria-hidden="true" />
                  <span>{text}</span>
                  <i aria-hidden="true" />
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
