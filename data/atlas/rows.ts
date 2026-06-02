import { atlasZones } from "./zones";

export type BedMode =
  | "annual_production"
  | "perennial_nursery"
  | "hospitality_showcase";

export type BedState =
  | "unassigned"
  | "planned"
  | "seeded"
  | "germinated"
  | "establishing"
  | "harvest_watch"
  | "harvesting"
  | "blocked"
  | "declining"
  | "cleared";

export type BedRecord = {
  id: string;
  zoneId: string;
  label: string;
  mode: BedMode;
  crop: string;
  state: BedState;
  x: number;
  y: number;
  width: number;
  height: number;
  guestVisible: boolean;
};

const MAIN_FIELD_WEST_STATES: BedState[] = [
  "harvest_watch",
  "germinated",
  "seeded",
  "planned",
  "planned",
  "planned",
  "planned",
  "planned",
];

const MAIN_FIELD_EAST_STATES: BedState[] = [
  "seeded",
  "planned",
  "planned",
  "planned",
  "planned",
  "planned",
  "planned",
  "planned",
];

const NURSERY_STATES: BedState[] = [
  "establishing",
  "establishing",
  "establishing",
  "establishing",
  "planned",
  "planned",
  "planned",
  "planned",
];

function getZoneBounds(zoneId: string) {
  const zone = atlasZones.find((item) => item.id === zoneId);

  if (!zone) {
    throw new Error(`Zone not found: ${zoneId}`);
  }

  const xs = zone.polygon.map((point) => point.x);
  const ys = zone.polygon.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

const mainField = getZoneBounds("main-field");
const nursery = getZoneBounds("nursery");

// Main Field layout
const mainOuterPadX = 18;
const mainTopPad = 28;
const mainBottomPad = 26;
const centerAisleWidth = 92;
const interBankGap = 18;

const usableMainHeight = mainField.height - mainTopPad - mainBottomPad;
const mainBedGap = 10;
const mainBedHeight = (usableMainHeight - mainBedGap * 7) / 8;

const mainBankWidth =
  (mainField.width - mainOuterPadX * 2 - centerAisleWidth - interBankGap * 2) / 2;

const westX = mainField.minX + mainOuterPadX;
const eastX = westX + mainBankWidth + interBankGap + centerAisleWidth + interBankGap;
const mainStartY = mainField.minY + mainTopPad;

// Nursery layout
const nurseryPadX = 28;
const nurseryTopPad = 26;
const nurseryBottomPad = 30;

const usableNurseryHeight = nursery.height - nurseryTopPad - nurseryBottomPad;
const nurseryGap = 8;
const nurseryBedHeight = (usableNurseryHeight - nurseryGap * 7) / 8;
const nurseryBedWidth = nursery.width - nurseryPadX * 2;
const nurseryX = nursery.minX + nurseryPadX;
const nurseryStartY = nursery.minY + nurseryTopPad;

const mainFieldWestBeds: BedRecord[] = Array.from(
  { length: 8 },
  (_, index): BedRecord => ({
  id: `MW${index + 1}`,
  zoneId: "main-field",
  label: `MW${index + 1}`,
  mode: "annual_production",
  crop:
    [
      "Snapdragon",
      "Scabiosa",
      "Strawflower",
      "Gomphrena",
      "Statice",
      "Bupleurum",
      "Lisianthus",
      "Sweet Pea",
    ][index] ?? "Open",
state: MAIN_FIELD_WEST_STATES[index] ?? "planned",
  x: westX,
  y: mainStartY + index * (mainBedHeight + mainBedGap),
  width: mainBankWidth,
  height: mainBedHeight,
  guestVisible: true,
  })
);

const mainFieldEastBeds: BedRecord[] = Array.from(
  { length: 8 },
  (_, index): BedRecord => ({
  id: `ME${index + 1}`,
  zoneId: "main-field",
  label: `ME${index + 1}`,
  mode: "annual_production",
  crop:
    [
      "Snapdragon",
      "Scabiosa",
      "Strawflower",
      "Gomphrena",
      "Statice",
      "Bupleurum",
      "Lisianthus",
      "Sweet Pea",
    ][index] ?? "Open",
state: MAIN_FIELD_EAST_STATES[index] ?? "planned",
  x: eastX,
  y: mainStartY + index * (mainBedHeight + mainBedGap),
  width: mainBankWidth,
  height: mainBedHeight,
  guestVisible: true,
  })
);

const nurseryBeds: BedRecord[] = Array.from(
  { length: 8 },
  (_, index): BedRecord => ({
  id: `N${index + 1}`,
  zoneId: "nursery",
  label: `N${index + 1}`,
  mode: "perennial_nursery",
  crop:
    [
      "Delphinium",
      "Foxglove",
      "Heuchera",
      "Salvia",
      "Echinacea",
      "Phlox",
      "Verbascum",
      "Coreopsis",
    ][index] ?? "Open",
state: NURSERY_STATES[index] ?? "planned",
  x: nurseryX,
  y: nurseryStartY + index * (nurseryBedHeight + nurseryGap),
  width: nurseryBedWidth,
  height: nurseryBedHeight,
  guestVisible: false,
  })
);

export const rows: BedRecord[] = [
  ...mainFieldWestBeds,
  ...mainFieldEastBeds,
  ...nurseryBeds,
];