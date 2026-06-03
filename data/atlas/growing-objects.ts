import type { AtlasAreaId } from "./field-types";

export type GrowingObjectKind =
  | "production_bed"
  | "suppression_bed"
  | "tight_row_block"
  | "garden_quadrant"
  | "center_space"
  | "perennial_strip"
  | "raised_arch_bed"
  | "salvage_area"
  | "walkway"
  | "general_area";

export type GrowingObject = {
  id: string;
  areaId: AtlasAreaId;
  label: string;
  shortLabel: string;
  kind: GrowingObjectKind;
  lengthFeet?: number;
  widthFeet?: number;
  defaultClaimUnit: "full_bed" | "partial_bed" | "arch" | "patch" | "clump";
  revenueEligible: boolean;
  plantingEligible: boolean;
  taskEligible: boolean;
  notes: string;
};

function makeBeds({
  areaId,
  prefix,
  labelPrefix,
  count,
  lengthFeet,
  widthFeet,
  kind,
  revenueEligible,
  notes,
}: {
  areaId: AtlasAreaId;
  prefix: string;
  labelPrefix: string;
  count: number;
  lengthFeet: number;
  widthFeet: number;
  kind: GrowingObjectKind;
  revenueEligible: boolean;
  notes: string;
}): GrowingObject[] {
  return Array.from({ length: count }, (_, index) => {
    const bedNumber = index + 1;

    return {
      id: `${prefix}_${bedNumber}`,
      areaId,
      label: `${labelPrefix} ${bedNumber}`,
      shortLabel: `${labelPrefix.replaceAll(" ", "")}${bedNumber}`,
      kind,
      lengthFeet,
      widthFeet,
      defaultClaimUnit: "full_bed",
      revenueEligible,
      plantingEligible: true,
      taskEligible: true,
      notes,
    };
  });
}

export const growingObjects: GrowingObject[] = [
  ...makeBeds({
    areaId: "field_rows",
    prefix: "field_row",
    labelPrefix: "Field Row",
    count: 20,
    lengthFeet: 25,
    widthFeet: 3,
    kind: "production_bed",
    revenueEligible: true,
    notes:
      "Fixed 25 ft x 3 ft production bed. Field Rows are the highest-priority 2026 production area.",
  }),

  ...makeBeds({
    areaId: "barn_beds",
    prefix: "barn_bed",
    labelPrefix: "Barn Bed",
    count: 8,
    lengthFeet: 15,
    widthFeet: 3,
    kind: "suppression_bed",
    revenueEligible: false,
    notes:
      "Fixed 15 ft x 3 ft barn-side bed. Severe Bermuda pressure; use for cheap bold suppression/appearance crops, not valuable perennial planting.",
  }),

  ...makeBeds({
    areaId: "berry_walk_flower_rows",
    prefix: "berry_flower_row",
    labelPrefix: "Berry Flower Row",
    count: 9,
    lengthFeet: 20,
    widthFeet: 3,
    kind: "suppression_bed",
    revenueEligible: false,
    notes:
      "Fixed 20 ft x 3 ft former annual flower row. Second-worst Bermuda pressure; use cheap bold crops until the area proves clean.",
  }),

  {
    id: "entry_billboard_tight_rows",
    areaId: "entry_billboard_garden",
    label: "Entry Billboard Tight Rows",
    shortLabel: "Entry Rows",
    kind: "tight_row_block",
    defaultClaimUnit: "patch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes:
      "Rectangle of dirt/mulch sown in tight visual rows without grass walkways. Track fullness and visibility more than bed math.",
  },

  {
    id: "entry_billboard_general",
    areaId: "entry_billboard_garden",
    label: "Entry Billboard General Area",
    shortLabel: "Entry",
    kind: "general_area",
    defaultClaimUnit: "patch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes:
      "General entry garden claim/task target. Use for weeding, blank-slate reset, garlic/sunflower/zinnia claims, and visual-readiness tasks.",
  },

  {
    id: "main_garden_north_quadrant",
    areaId: "main_garden",
    label: "Main Garden North Quadrant",
    shortLabel: "MG North",
    kind: "garden_quadrant",
    defaultClaimUnit: "patch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes:
      "Main Garden quadrant. Track fullness, potager planting, weeds, and future perennial structure rather than revenue.",
  },
  {
    id: "main_garden_east_quadrant",
    areaId: "main_garden",
    label: "Main Garden East Quadrant",
    shortLabel: "MG East",
    kind: "garden_quadrant",
    defaultClaimUnit: "patch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes:
      "Main Garden quadrant. Track fullness, potager planting, weeds, and future perennial structure rather than revenue.",
  },
  {
    id: "main_garden_south_quadrant",
    areaId: "main_garden",
    label: "Main Garden South Quadrant",
    shortLabel: "MG South",
    kind: "garden_quadrant",
    defaultClaimUnit: "patch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes:
      "Main Garden quadrant. Track fullness, potager planting, weeds, and future perennial structure rather than revenue.",
  },
  {
    id: "main_garden_west_quadrant",
    areaId: "main_garden",
    label: "Main Garden West Quadrant",
    shortLabel: "MG West",
    kind: "garden_quadrant",
    defaultClaimUnit: "patch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes:
      "Main Garden quadrant. Track fullness, potager planting, weeds, and future perennial structure rather than revenue.",
  },
  {
    id: "main_garden_center_diamond",
    areaId: "main_garden",
    label: "Main Garden Center Diamond",
    shortLabel: "MG Center",
    kind: "center_space",
    defaultClaimUnit: "patch",
    revenueEligible: false,
    plantingEligible: false,
    taskEligible: true,
    notes:
      "Diamond/patio-style center seating area. Track path, mud, stepping stones, weeds, and hospitality readiness.",
  },

  {
    id: "curve_perennial_strip",
    areaId: "curve_garden",
    label: "Curve Garden Perennial Strip",
    shortLabel: "Curve Strip",
    kind: "perennial_strip",
    lengthFeet: 30,
    widthFeet: 2,
    defaultClaimUnit: "patch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes:
      "Approximately 30 ft long with about 2 ft of perennial planting along the curve. Track weeding, gaps, and perennial fullness.",
  },

  {
    id: "curve_arch_set_1_left_bed",
    areaId: "curve_garden",
    label: "Curve Arch Set 1 Left Bed",
    shortLabel: "Curve 1L",
    kind: "raised_arch_bed",
    defaultClaimUnit: "arch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes: "Small raised bed paired with an arch. Track vines, weeding, and visible entry structure.",
  },
  {
    id: "curve_arch_set_1_right_bed",
    areaId: "curve_garden",
    label: "Curve Arch Set 1 Right Bed",
    shortLabel: "Curve 1R",
    kind: "raised_arch_bed",
    defaultClaimUnit: "arch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes: "Small raised bed paired with an arch. Track vines, weeding, and visible entry structure.",
  },
  {
    id: "curve_arch_set_2_left_bed",
    areaId: "curve_garden",
    label: "Curve Arch Set 2 Left Bed",
    shortLabel: "Curve 2L",
    kind: "raised_arch_bed",
    defaultClaimUnit: "arch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes: "Small raised bed paired with an arch. Track vines, weeding, and visible entry structure.",
  },
  {
    id: "curve_arch_set_2_right_bed",
    areaId: "curve_garden",
    label: "Curve Arch Set 2 Right Bed",
    shortLabel: "Curve 2R",
    kind: "raised_arch_bed",
    defaultClaimUnit: "arch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes: "Small raised bed paired with an arch. Track vines, weeding, and visible entry structure.",
  },
  {
    id: "curve_arch_set_3_left_bed",
    areaId: "curve_garden",
    label: "Curve Arch Set 3 Left Bed",
    shortLabel: "Curve 3L",
    kind: "raised_arch_bed",
    defaultClaimUnit: "arch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes: "Small raised bed paired with an arch. Track vines, weeding, and visible entry structure.",
  },
  {
    id: "curve_arch_set_3_right_bed",
    areaId: "curve_garden",
    label: "Curve Arch Set 3 Right Bed",
    shortLabel: "Curve 3R",
    kind: "raised_arch_bed",
    defaultClaimUnit: "arch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes: "Small raised bed paired with an arch. Track vines, weeding, and visible entry structure.",
  },

  {
    id: "berry_walk_original_salvage_area",
    areaId: "berry_walk_original",
    label: "Berry Walk Original Salvage Area",
    shortLabel: "BW Salvage",
    kind: "salvage_area",
    defaultClaimUnit: "patch",
    revenueEligible: false,
    plantingEligible: false,
    taskEligible: true,
    notes:
      "Observe/salvage area. Track poppy seed saving, catmint/lambs ear/lemon balm salvage, mowing/reset, and grief-protected decisions.",
  },

  {
    id: "follow_me_arch_set_1",
    areaId: "follow_me_to_flowers",
    label: "Follow Me Arch Set 1",
    shortLabel: "FM 1",
    kind: "raised_arch_bed",
    defaultClaimUnit: "arch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes:
      "Arrival path arch bed. Track vine planting, weeding, and central guest-impression tasks.",
  },
  {
    id: "follow_me_arch_set_2",
    areaId: "follow_me_to_flowers",
    label: "Follow Me Arch Set 2",
    shortLabel: "FM 2",
    kind: "raised_arch_bed",
    defaultClaimUnit: "arch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes:
      "Arrival path arch bed. Track vine planting, weeding, and central guest-impression tasks.",
  },
  {
    id: "follow_me_arch_set_3",
    areaId: "follow_me_to_flowers",
    label: "Follow Me Arch Set 3",
    shortLabel: "FM 3",
    kind: "raised_arch_bed",
    defaultClaimUnit: "arch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes:
      "Arrival path arch bed. Track vine planting, weeding, and central guest-impression tasks.",
  },
  {
    id: "follow_me_arch_set_4",
    areaId: "follow_me_to_flowers",
    label: "Follow Me Arch Set 4",
    shortLabel: "FM 4",
    kind: "raised_arch_bed",
    defaultClaimUnit: "arch",
    revenueEligible: false,
    plantingEligible: true,
    taskEligible: true,
    notes:
      "Arrival path arch bed. Track vine planting, weeding, and central guest-impression tasks.",
  },
];

export function getGrowingObjectsForArea(areaId: AtlasAreaId) {
  return growingObjects.filter((object) => object.areaId === areaId);
}

export function getPlantingObjectsForArea(areaId: AtlasAreaId) {
  return growingObjects.filter((object) => object.areaId === areaId && object.plantingEligible);
}

export function getTaskObjectsForArea(areaId: AtlasAreaId) {
  return growingObjects.filter((object) => object.areaId === areaId && object.taskEligible);
}

export function getGrowingObject(objectId?: string | null) {
  if (!objectId) return null;
  return growingObjects.find((object) => object.id === objectId) ?? null;
}

export function getGrowingObjectLabel(objectId?: string | null) {
  return getGrowingObject(objectId)?.label ?? null;
}

export function getDefaultGrowingObjectForArea(areaId: AtlasAreaId) {
  return getPlantingObjectsForArea(areaId)[0] ?? null;
}