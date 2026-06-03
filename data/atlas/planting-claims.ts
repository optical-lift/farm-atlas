import type { AtlasAreaId } from "./field-types";
import type { CropProfileId } from "./crop-profiles";

export type PlantingClaim = {
  id: string;
  areaId: AtlasAreaId;
  objectId?: string;
  cropId: CropProfileId;
  plantedDate: string;
  unit: "full_bed" | "partial_bed" | "arch" | "patch" | "clump";
  unitCount: number;
  bedLengthFeet?: number;
  bedWidthInches?: number;
  notes?: string;
};

export const plantingClaims: PlantingClaim[] = [
  {
    id: "claim_field_row_1_black_oil_sunflower_001",
    areaId: "field_rows",
    objectId: "field_row_1",
    cropId: "black_oil_sunflower",
    plantedDate: "2026-06-02",
    unit: "full_bed",
    unitCount: 1,
    notes: "Prototype claim. Field Row 1 uses fixed 25 ft x 3 ft bed dimensions.",
  },
  {
    id: "claim_field_row_2_black_oil_sunflower_001",
    areaId: "field_rows",
    objectId: "field_row_2",
    cropId: "black_oil_sunflower",
    plantedDate: "2026-06-02",
    unit: "full_bed",
    unitCount: 1,
    notes: "Prototype claim. Field Row 2 uses fixed 25 ft x 3 ft bed dimensions.",
  },
  {
    id: "claim_field_row_3_black_oil_sunflower_001",
    areaId: "field_rows",
    objectId: "field_row_3",
    cropId: "black_oil_sunflower",
    plantedDate: "2026-06-02",
    unit: "full_bed",
    unitCount: 1,
    notes: "Prototype claim. Field Row 3 uses fixed 25 ft x 3 ft bed dimensions.",
  },
  {
    id: "claim_field_row_4_black_oil_sunflower_001",
    areaId: "field_rows",
    objectId: "field_row_4",
    cropId: "black_oil_sunflower",
    plantedDate: "2026-06-02",
    unit: "full_bed",
    unitCount: 1,
    notes: "Prototype claim. Field Row 4 uses fixed 25 ft x 3 ft bed dimensions.",
  },
  {
    id: "claim_field_row_5_black_oil_sunflower_001",
    areaId: "field_rows",
    objectId: "field_row_5",
    cropId: "black_oil_sunflower",
    plantedDate: "2026-06-02",
    unit: "full_bed",
    unitCount: 1,
    notes: "Prototype claim. Field Row 5 uses fixed 25 ft x 3 ft bed dimensions.",
  },
  {
    id: "claim_field_row_6_bush_bean_001",
    areaId: "field_rows",
    objectId: "field_row_6",
    cropId: "bush_bean",
    plantedDate: "2026-06-02",
    unit: "full_bed",
    unitCount: 1,
    notes: "Prototype food crop claim. Food revenue model comes later.",
  },
  {
    id: "claim_field_row_7_bush_bean_001",
    areaId: "field_rows",
    objectId: "field_row_7",
    cropId: "bush_bean",
    plantedDate: "2026-06-02",
    unit: "full_bed",
    unitCount: 1,
    notes: "Prototype food crop claim. Food revenue model comes later.",
  },
];