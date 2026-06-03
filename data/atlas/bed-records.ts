export type BedRecord = {
  id: string;

  zoneId: string;
  objectId: string;

  createdAt: string;
  updatedAt: string;

  contents: BedContent[];
  observations: BedObservation[];
};

export type BedContent = {
  id: string;

  type:
    | "crop"
    | "perennial"
    | "herb"
    | "flower"
    | "cover_crop";

sourceType?: "hardened_seedling" | "division" | "nursery_purchase";

  cropId: string;

  plantedDate: string;

  quantity?: number;
  unit?: string;

  status:
    | "planted"
    | "germinating"
    | "established"
    | "harvesting"
    | "declining"
    | "cleared";

  notes?: string;
};

export type BedObservation = {
  id: string;

  date: string;

  category:
    | "weed_pressure"
    | "pest_pressure"
    | "water"
    | "damage"
    | "general";

  severity:
    | "low"
    | "medium"
    | "high";

  note: string;
};


export const bedRecords: BedRecord[] = [];