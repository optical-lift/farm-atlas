"use client";

import type {
  AtlasBedMap,
  AtlasBedMapPlacement,
  AtlasMapEdge,
} from "@/lib/atlas/weed-card-contract";
import styles from "./crop-occupancy-bed-map.module.css";

type Props = {
  map: AtlasBedMap | null | undefined;
};

function edgeLabel(edge: AtlasMapEdge | null | undefined) {
  return edge ? edge.slice(0, 1).toUpperCase() : "?";
}

function numberLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
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
  return [placement.displayLabel, quantityLabel(placement), placement.stageLabel]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function rowCount(placement: AtlasBedMapPlacement) {
  if (placement.placementMode === "full_rows" || placement.placementMode === "partial_rows") {
    return Math.max(1, Math.min(4, Math.round(placement.rowCount ?? 1)));
  }
  return 1;
}

function rowStyle(placement: AtlasBedMapPlacement, lengthFt: number | null) {
  if (!lengthFt || lengthFt <= 0) return undefined;
  const start = placement.longStartFt ?? 0;
  const knownEnd = placement.longEndFt;
  const span = knownEnd != null
    ? Math.max(0.5, knownEnd - start)
    : placement.rowLengthFt ?? lengthFt;
  return {
    marginInlineStart: `${Math.max(0, Math.min(96, (start / lengthFt) * 100))}%`,
    width: `${Math.max(12, Math.min(100, (span / lengthFt) * 100))}%`,
  };
}

function EdgeBand({ placements, edge }: { placements: AtlasBedMapPlacement[]; edge: "left" | "right" }) {
  if (!placements.length) return null;
  const names = Array.from(new Set(placements.map((placement) => placement.displayLabel)));
  return (
    <div className={`${styles.edgeBand} ${edge === "left" ? styles.leftBand : styles.rightBand}`}>
      <span>{names.join(" · ")}</span>
    </div>
  );
}

export default function CropOccupancyBedMap({ map }: Props) {
  if (!map || !map.placements.length) return null;

  const leftAnchored = map.placements.filter((placement) => placement.anchorEdge === map.leftEdge);
  const rightAnchored = map.placements.filter((placement) => placement.anchorEdge === map.rightEdge);
  const topAnchored = map.placements.filter((placement) => placement.anchorEdge === map.topEdge);
  const bottomAnchored = map.placements.filter((placement) => placement.anchorEdge === map.bottomEdge);
  const anchoredIds = new Set([...leftAnchored, ...rightAnchored, ...topAnchored, ...bottomAnchored].map((placement) => placement.placementId));
  const bodyPlacements = map.placements.filter((placement) => !anchoredIds.has(placement.placementId));

  return (
    <section className={styles.root} aria-label={`Oriented planting map for ${map.objectLabel}`}>
      <div className={styles.topDirection}>{edgeLabel(map.topEdge)}</div>
      <div className={styles.horizontalMap}>
        <span className={styles.sideDirection}>{edgeLabel(map.leftEdge)} ←</span>
        <div className={styles.bed}>
          {topAnchored.length ? <div className={`${styles.crossBand} ${styles.topBand}`}>{topAnchored.map((item) => item.displayLabel).join(" · ")}</div> : null}
          <div className={styles.bedBody}>
            <EdgeBand placements={leftAnchored} edge="left" />
            <div className={styles.rows}>
              {bodyPlacements.map((placement) => {
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
            </div>
            <EdgeBand placements={rightAnchored} edge="right" />
          </div>
          {bottomAnchored.length ? <div className={`${styles.crossBand} ${styles.bottomBand}`}>{bottomAnchored.map((item) => item.displayLabel).join(" · ")}</div> : null}
        </div>
        <span className={styles.sideDirection}>→ {edgeLabel(map.rightEdge)}</span>
      </div>
      <div className={styles.bottomDirection}>{edgeLabel(map.bottomEdge)}</div>
    </section>
  );
}