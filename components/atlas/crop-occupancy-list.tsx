"use client";

import type {
  AtlasCropOccupancyCohort,
  AtlasCropOccupancyGroup,
} from "@/lib/atlas/weed-card-contract";
import styles from "./crop-occupancy-list.module.css";

type Props = {
  groups: AtlasCropOccupancyGroup[];
};

function numberLabel(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function expectedFact(cohort: AtlasCropOccupancyCohort) {
  if (cohort.expectedQuantity == null || cohort.expectedQuantityKind === "unknown") return null;
  const amount = numberLabel(cohort.expectedQuantity);
  if (cohort.expectedQuantityUnit === "seeds") return `${amount} seeds sown`;
  if (cohort.expectedQuantityUnit === "clumps") return `${amount} ${cohort.expectedQuantity === 1 ? "clump" : "clumps"}`;
  if (cohort.expectedQuantityKind === "calculated") return `~${amount} expected`;
  if (cohort.placementMode === "individual_plants" && cohort.placementSummary) return null;
  return `${amount} ${cohort.expectedQuantity === 1 ? "plant" : "plants"}`;
}

function observedFact(cohort: AtlasCropOccupancyCohort) {
  if (cohort.observedQuantity == null) return null;
  const amount = numberLabel(cohort.observedQuantity);
  const unit = cohort.observedQuantityUnit === "clumps"
    ? cohort.observedQuantity === 1 ? "clump" : "clumps"
    : "current";
  return `${amount} ${unit}`;
}

function cohortFacts(cohort: AtlasCropOccupancyCohort) {
  return [
    cohort.placementSummary,
    expectedFact(cohort),
    observedFact(cohort),
    cohort.standPercent == null ? null : `${numberLabel(cohort.standPercent)}% stand`,
  ].filter((value): value is string => Boolean(value));
}

export default function CropOccupancyList({ groups }: Props) {
  const visibleGroups = groups.filter((group) => group.cohorts.length > 0);
  if (!visibleGroups.length) return null;

  return (
    <section className={styles.root} aria-label="Crop occupancy">
      {visibleGroups.map((group) => (
        <section className={styles.group} key={`${group.groupKind}:${group.groupDate ?? "none"}`}>
          <h2>{group.groupLabel}</h2>
          <ul>
            {group.cohorts.map((cohort) => {
              const facts = cohortFacts(cohort);
              return (
                <li key={cohort.cropCycleId}>
                  <strong>{cohort.displayLabel}</strong>
                  {facts.length ? <p>{facts.join(" · ")}</p> : null}
                  <small>{cohort.stageLabel}</small>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}