export type CropProfileId =
  | "black_oil_sunflower"
  | "italian_white_sunflower"
  | "california_giant_zinnia"
  | "bush_bean"
  | "garlic"
  | "dark_opal_basil"
  | "muncher_cucumber"
  | "louisiana_green_velvet_okra"
  | "queensland_blue_squash"
  | "purple_hyacinth_bean"
  | "alyssum_white"
  | "chives";

export type CropProfile = {
  id: CropProfileId;
  label: string;
  cropClass:
    | "cut_flower"
    | "food"
    | "herb"
    | "vine"
    | "bulb"
    | "edge"
    | "cover";
  defaultUnit: "bed" | "arch" | "patch" | "clump";
  spacingInches: number | null;
  rowsPerThirtyInchBed: number | null;
  germinationDaysMin: number | null;
  germinationDaysMax: number | null;
  harvestDaysMin: number | null;
  harvestDaysMax: number | null;
  expectedStemsPerPlantMin: number;
  expectedStemsPerPlantMax: number;
  expectedSellThroughRate: number;
  pricePerStemLow: number;
  pricePerStemHigh: number;
  notes: string;
};

export const cropProfiles: CropProfile[] = [
  {
    id: "black_oil_sunflower",
    label: "Black Oil Sunflower",
    cropClass: "cut_flower",
    defaultUnit: "bed",
    spacingInches: 9,
    rowsPerThirtyInchBed: 3,
    germinationDaysMin: 4,
    germinationDaysMax: 10,
    harvestDaysMin: 65,
    harvestDaysMax: 85,
    expectedStemsPerPlantMin: 1,
    expectedStemsPerPlantMax: 1,
    expectedSellThroughRate: 0.7,
    pricePerStemLow: 1,
    pricePerStemHigh: 2,
    notes:
      "Cheap bold crop. Best for mass, suppression, visibility, and simple stem production.",
  },
  {
    id: "italian_white_sunflower",
    label: "Italian White Sunflower",
    cropClass: "cut_flower",
    defaultUnit: "bed",
    spacingInches: 9,
    rowsPerThirtyInchBed: 3,
    germinationDaysMin: 4,
    germinationDaysMax: 10,
    harvestDaysMin: 65,
    harvestDaysMax: 85,
    expectedStemsPerPlantMin: 1,
    expectedStemsPerPlantMax: 1,
    expectedSellThroughRate: 0.75,
    pricePerStemLow: 1.5,
    pricePerStemHigh: 2.5,
    notes:
      "More intentional sunflower crop. Better for visible areas and florist-looking harvests.",
  },
  {
    id: "california_giant_zinnia",
    label: "California Giant Zinnia",
    cropClass: "cut_flower",
    defaultUnit: "bed",
    spacingInches: 12,
    rowsPerThirtyInchBed: 3,
    germinationDaysMin: 3,
    germinationDaysMax: 7,
    harvestDaysMin: 60,
    harvestDaysMax: 75,
    expectedStemsPerPlantMin: 6,
    expectedStemsPerPlantMax: 12,
    expectedSellThroughRate: 0.7,
    pricePerStemLow: 0.75,
    pricePerStemHigh: 1.5,
    notes:
      "High-volume cut flower. Needs cutting rhythm and should not be wasted in high Bermuda pressure.",
  },
  {
    id: "bush_bean",
    label: "Bush Bean",
    cropClass: "food",
    defaultUnit: "bed",
    spacingInches: 4,
    rowsPerThirtyInchBed: 3,
    germinationDaysMin: 4,
    germinationDaysMax: 10,
    harvestDaysMin: 50,
    harvestDaysMax: 65,
    expectedStemsPerPlantMin: 0,
    expectedStemsPerPlantMax: 0,
    expectedSellThroughRate: 0.6,
    pricePerStemLow: 0,
    pricePerStemHigh: 0,
    notes:
      "Food crop. Revenue should later be calculated by pounds, not stems.",
  },
  {
    id: "garlic",
    label: "Garlic",
    cropClass: "bulb",
    defaultUnit: "clump",
    spacingInches: 6,
    rowsPerThirtyInchBed: 4,
    germinationDaysMin: null,
    germinationDaysMax: null,
    harvestDaysMin: null,
    harvestDaysMax: null,
    expectedStemsPerPlantMin: 0,
    expectedStemsPerPlantMax: 0,
    expectedSellThroughRate: 0.75,
    pricePerStemLow: 0,
    pricePerStemHigh: 0,
    notes:
      "Existing clumped garlic should be dug, separated, and reset as future seed stock / harvest stock.",
  },
  {
    id: "dark_opal_basil",
    label: "Dark Opal Basil",
    cropClass: "herb",
    defaultUnit: "bed",
    spacingInches: 12,
    rowsPerThirtyInchBed: 3,
    germinationDaysMin: 5,
    germinationDaysMax: 10,
    harvestDaysMin: 45,
    harvestDaysMax: 65,
    expectedStemsPerPlantMin: 4,
    expectedStemsPerPlantMax: 10,
    expectedSellThroughRate: 0.6,
    pricePerStemLow: 0.5,
    pricePerStemHigh: 1,
    notes:
      "Useful for potager, color, herb harvest, and bouquet foliage/support.",
  },
  {
    id: "muncher_cucumber",
    label: "Muncher Cucumber",
    cropClass: "vine",
    defaultUnit: "arch",
    spacingInches: 12,
    rowsPerThirtyInchBed: 1,
    germinationDaysMin: 3,
    germinationDaysMax: 10,
    harvestDaysMin: 55,
    harvestDaysMax: 70,
    expectedStemsPerPlantMin: 0,
    expectedStemsPerPlantMax: 0,
    expectedSellThroughRate: 0.6,
    pricePerStemLow: 0,
    pricePerStemHigh: 0,
    notes:
      "Lighter edible vine option for arches.",
  },
  {
    id: "louisiana_green_velvet_okra",
    label: "Louisiana Green Velvet Okra",
    cropClass: "food",
    defaultUnit: "bed",
    spacingInches: 18,
    rowsPerThirtyInchBed: 1,
    germinationDaysMin: 5,
    germinationDaysMax: 14,
    harvestDaysMin: 55,
    harvestDaysMax: 75,
    expectedStemsPerPlantMin: 0,
    expectedStemsPerPlantMax: 0,
    expectedSellThroughRate: 0.6,
    pricePerStemLow: 0,
    pricePerStemHigh: 0,
    notes:
      "Warm-season food crop. Best in Main Garden or Field Rows.",
  },
  {
    id: "queensland_blue_squash",
    label: "Queensland Blue Squash",
    cropClass: "vine",
    defaultUnit: "arch",
    spacingInches: 24,
    rowsPerThirtyInchBed: 1,
    germinationDaysMin: 4,
    germinationDaysMax: 10,
    harvestDaysMin: 95,
    harvestDaysMax: 120,
    expectedStemsPerPlantMin: 0,
    expectedStemsPerPlantMax: 0,
    expectedSellThroughRate: 0.5,
    pricePerStemLow: 0,
    pricePerStemHigh: 0,
    notes:
      "Large vine. Use only where it will not swallow paths.",
  },
  {
    id: "purple_hyacinth_bean",
    label: "Purple Hyacinth Bean",
    cropClass: "vine",
    defaultUnit: "arch",
    spacingInches: 12,
    rowsPerThirtyInchBed: 1,
    germinationDaysMin: 7,
    germinationDaysMax: 14,
    harvestDaysMin: 60,
    harvestDaysMax: 90,
    expectedStemsPerPlantMin: 0,
    expectedStemsPerPlantMax: 0,
    expectedSellThroughRate: 0.5,
    pricePerStemLow: 0,
    pricePerStemHigh: 0,
    notes:
      "Fast vertical beauty for arches and entry drama.",
  },
  {
    id: "alyssum_white",
    label: "White Alyssum",
    cropClass: "edge",
    defaultUnit: "patch",
    spacingInches: 6,
    rowsPerThirtyInchBed: null,
    germinationDaysMin: 5,
    germinationDaysMax: 14,
    harvestDaysMin: 45,
    harvestDaysMax: 60,
    expectedStemsPerPlantMin: 0,
    expectedStemsPerPlantMax: 0,
    expectedSellThroughRate: 0,
    pricePerStemLow: 0,
    pricePerStemHigh: 0,
    notes:
      "Edge/support crop. Best used in clean contained edges, not scattered everywhere.",
  },
  {
    id: "chives",
    label: "Chives",
    cropClass: "herb",
    defaultUnit: "clump",
    spacingInches: 12,
    rowsPerThirtyInchBed: 1,
    germinationDaysMin: 7,
    germinationDaysMax: 14,
    harvestDaysMin: 80,
    harvestDaysMax: 100,
    expectedStemsPerPlantMin: 0,
    expectedStemsPerPlantMax: 0,
    expectedSellThroughRate: 0,
    pricePerStemLow: 0,
    pricePerStemHigh: 0,
    notes:
      "Semi-permanent herb structure for Main Garden, Curve Garden, or Entry Billboard.",
  },
];

export function getCropProfile(cropId: CropProfileId) {
  const crop = cropProfiles.find((profile) => profile.id === cropId);

  if (!crop) {
    throw new Error(`Unknown crop profile: ${cropId}`);
  }

  return crop;
}