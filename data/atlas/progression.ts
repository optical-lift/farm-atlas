export type ProgressState =
  | "blocked"
  | "open"
  | "ready"
  | "active"
  | "establishing"
  | "raw";

export type ProgressRecord = {
  id: string;
  title: string;
  state: ProgressState;
  note: string;
  linkedZoneIds: string[];
};

export const progression: ProgressRecord[] = [
  {
    id: "main-field",
    title: "Main Field",
    state: "active",
    note: "Beds are defined. Production lane is taking shape.",
    linkedZoneIds: ["main-field"],
  },
  {
    id: "nursery",
    title: "Nursery",
    state: "establishing",
    note: "Perennial growout lane is present but still early.",
    linkedZoneIds: ["nursery"],
  },
  {
    id: "hospitality-court",
    title: "Hospitality Court",
    state: "raw",
    note: "Structure is named, but visual continuity logic is still ahead.",
    linkedZoneIds: ["hospitality-court"],
  },
  {
    id: "center-aisle",
    title: "Center Aisle",
    state: "open",
    note: "Exists as the main field spine and should become a first-class corridor next.",
    linkedZoneIds: ["main-field"],
  },
];