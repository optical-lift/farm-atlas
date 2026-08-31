export const FLOWER_HARVEST_GRADES = ["florist_grade", "event_grade"] as const;
export type FlowerHarvestGrade = (typeof FLOWER_HARVEST_GRADES)[number];

export const FLOWER_NON_HARVEST_DISPOSITIONS = ["deadheaded", "crop_loss"] as const;
export type FlowerNonHarvestDisposition = (typeof FLOWER_NON_HARVEST_DISPOSITIONS)[number];

export const FLOWER_SELLABLE_FORMS = ["stem", "bundle", "posy", "bouquet", "arrangement"] as const;
export type FlowerSellableForm = (typeof FLOWER_SELLABLE_FORMS)[number];

export const FLOWER_BUNDLE_STEM_COUNTS = [5, 10, 20] as const;
export type FlowerBundleStemCount = (typeof FLOWER_BUNDLE_STEM_COUNTS)[number];

export const FLOWER_HARVEST_VOCABULARY = {
  florist_grade: {
    label: "Florist grade",
    meaning: "Freshly harvested at the correct florist stage.",
    createsHarvestInventory: true,
  },
  event_grade: {
    label: "Event grade",
    meaning: "Harvested after the flower has blown open beyond florist stage but is still usable.",
    createsHarvestInventory: true,
  },
  deadheaded: {
    label: "Deadheaded",
    meaning: "Unusable bloom removed from a cut-and-come-again crop.",
    createsHarvestInventory: false,
  },
  crop_loss: {
    label: "Crop loss",
    meaning: "Unusable one-cut flower recorded as production loss.",
    createsHarvestInventory: false,
  },
} as const;

export const FLOWER_FORM_VOCABULARY = {
  stem: {
    label: "Stem",
    wrapping: "none",
    flowerFeedPacket: false,
    container: "none",
  },
  bundle: {
    label: "Bundle",
    allowedStemCounts: FLOWER_BUNDLE_STEM_COUNTS,
    preparation: "stripped_and_rubber_banded",
    wrapping: "none",
    flowerFeedPacket: false,
    container: "none",
  },
  posy: {
    label: "Posy",
    wrapping: "paper",
    flowerFeedPacket: true,
    flowerFeedPlacement: "inside_rubber_band",
    container: "none",
  },
  bouquet: {
    label: "Bouquet",
    wrapping: "paper",
    flowerFeedPacket: true,
    flowerFeedPlacement: "inside_rubber_band",
    container: "none",
  },
  arrangement: {
    label: "Arrangement",
    wrapping: "none",
    flowerFeedPacket: false,
    container: "vase_or_jar",
  },
} as const;

export function isCanonicalFlowerBundleStemCount(value: number): value is FlowerBundleStemCount {
  return FLOWER_BUNDLE_STEM_COUNTS.includes(value as FlowerBundleStemCount);
}
