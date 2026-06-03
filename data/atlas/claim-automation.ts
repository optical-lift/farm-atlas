import type { AtlasAreaId } from "./field-types";
import { getCropProfile } from "./crop-profiles";
import { plantingClaims, type PlantingClaim } from "./planting-claims";
import { getGrowingObject, getGrowingObjectLabel } from "./growing-objects";

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00`);
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00`).getTime();
  const end = new Date(`${endDate}T12:00:00`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function resolveClaimLengthFeet(claim: PlantingClaim) {
  const object = getGrowingObject(claim.objectId);

  return object?.lengthFeet ?? claim.bedLengthFeet ?? null;
}

function resolveClaimWidthInches(claim: PlantingClaim) {
  const object = getGrowingObject(claim.objectId);
  const objectWidthInches = object?.widthFeet ? object.widthFeet * 12 : null;

  return objectWidthInches ?? claim.bedWidthInches ?? null;
}

function isRevenueEligibleClaim(claim: PlantingClaim) {
  const object = getGrowingObject(claim.objectId);

  if (!object) return true;

  return object.revenueEligible;
}

function estimatePlants(claim: PlantingClaim) {
  const crop = getCropProfile(claim.cropId);
  const lengthFeet = resolveClaimLengthFeet(claim);
  const widthInches = resolveClaimWidthInches(claim);

  if (!crop.spacingInches || !crop.rowsPerThirtyInchBed || !lengthFeet) {
    return 0;
  }

  const widthMultiplier = widthInches ? widthInches / 30 : 1;
  const effectiveRows = Math.max(1, Math.round(crop.rowsPerThirtyInchBed * widthMultiplier));
  const bedLengthInches = lengthFeet * 12;
  const plantsPerRow = Math.floor(bedLengthInches / crop.spacingInches);
  const plantsPerObject = plantsPerRow * effectiveRows;

  if (claim.unit === "full_bed" || claim.unit === "partial_bed") {
    return Math.round(plantsPerObject * claim.unitCount);
  }

  if (claim.unit === "arch") {
    return Math.max(1, Math.round(plantsPerObject * claim.unitCount));
  }

  return Math.max(1, Math.round(plantsPerObject * claim.unitCount));
}

export function deriveClaim(claim: PlantingClaim, today = new Date().toISOString().slice(0, 10)) {
  const crop = getCropProfile(claim.cropId);
  const object = getGrowingObject(claim.objectId);
  const objectLabel = getGrowingObjectLabel(claim.objectId);
  const estimatedPlants = estimatePlants(claim);
  const revenueEligible = isRevenueEligibleClaim(claim);

  const estimatedStemsLow = estimatedPlants * crop.expectedStemsPerPlantMin;
  const estimatedStemsHigh = estimatedPlants * crop.expectedStemsPerPlantMax;

  const sellableStemsLow = Math.round(estimatedStemsLow * crop.expectedSellThroughRate);
  const sellableStemsHigh = Math.round(estimatedStemsHigh * crop.expectedSellThroughRate);

  const revenueLow = revenueEligible ? sellableStemsLow * crop.pricePerStemLow : 0;
  const revenueHigh = revenueEligible ? sellableStemsHigh * crop.pricePerStemHigh : 0;

  const germinationCheckStart =
    crop.germinationDaysMin === null ? null : addDays(claim.plantedDate, crop.germinationDaysMin);

  const germinationCheckEnd =
    crop.germinationDaysMax === null ? null : addDays(claim.plantedDate, crop.germinationDaysMax);

  const harvestStart =
    crop.harvestDaysMin === null ? null : addDays(claim.plantedDate, crop.harvestDaysMin);

  const harvestEnd =
    crop.harvestDaysMax === null ? null : addDays(claim.plantedDate, crop.harvestDaysMax);

  const daysToHarvestStart = harvestStart ? daysBetween(today, harvestStart) : null;

  const resolvedLengthFeet = resolveClaimLengthFeet(claim);
  const resolvedWidthInches = resolveClaimWidthInches(claim);

  return {
    claim,
    crop,
    object,
    objectLabel,
    resolvedLengthFeet,
    resolvedWidthInches,
    sizeLabel:
      resolvedLengthFeet && resolvedWidthInches
        ? `${resolvedLengthFeet} ft × ${Math.round(resolvedWidthInches / 12)} ft`
        : object?.kind.replaceAll("_", " ") ?? "custom patch",
    revenueEligible,
    estimatedPlants,
    estimatedStemsLow,
    estimatedStemsHigh,
    sellableStemsLow,
    sellableStemsHigh,
    revenueLow,
    revenueHigh,
    revenueLabel:
      !revenueEligible
        ? "not revenue-tracked"
        : revenueLow === 0 && revenueHigh === 0
          ? "not stem-priced"
          : `${formatMoney(revenueLow)}–${formatMoney(revenueHigh)}`,
    germinationCheckStart,
    germinationCheckEnd,
    harvestStart,
    harvestEnd,
    daysToHarvestStart,
    harvestCountdownLabel:
      daysToHarvestStart === null
        ? "not dated"
        : daysToHarvestStart <= 0
          ? "harvest watch"
          : `${daysToHarvestStart} days`,
  };
}

export function getDerivedClaimsForArea(
  areaId: AtlasAreaId,
  claims: PlantingClaim[] = plantingClaims,
) {
  return claims
    .filter((claim) => claim.areaId === areaId)
    .map((claim) => deriveClaim(claim));
}

export function getAreaInventorySummary(
  areaId: AtlasAreaId,
  claims: PlantingClaim[] = plantingClaims,
) {
  const derivedClaims = getDerivedClaimsForArea(areaId, claims);

  const plantedBeds = derivedClaims
    .filter((item) => item.claim.unit === "full_bed" || item.claim.unit === "partial_bed")
    .reduce((total, item) => total + item.claim.unitCount, 0);

  const claimedObjects = Array.from(
    new Set(
      derivedClaims
        .map((item) => item.objectLabel)
        .filter((label): label is string => Boolean(label)),
    ),
  );

  const crops = Array.from(new Set(derivedClaims.map((item) => item.crop.label)));

  const revenueLow = derivedClaims.reduce((total, item) => total + item.revenueLow, 0);
  const revenueHigh = derivedClaims.reduce((total, item) => total + item.revenueHigh, 0);

  const harvestCountdowns = derivedClaims
    .map((item) => item.daysToHarvestStart)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const nextHarvest =
    harvestCountdowns.length === 0
      ? "not dated"
      : harvestCountdowns[0] <= 0
        ? "harvest watch"
        : `${harvestCountdowns[0]} days`;

  return {
    plantedBeds,
    claimedObjectsLabel: claimedObjects.length ? claimedObjects.join(" · ") : "no objects claimed",
    cropsLabel: crops.length ? crops.join(" · ") : "none claimed",
    nextHarvest,
    revenueLabel:
      revenueLow === 0 && revenueHigh === 0
        ? derivedClaims.some((claim) => !claim.revenueEligible)
          ? "not revenue-tracked"
          : "not stem-priced"
        : `${formatMoney(revenueLow)}–${formatMoney(revenueHigh)}`,
    derivedClaims,
  };
}