export type MowingCardCanonicalInput = {
  routeLabel: string;
  zoneLabel: string;
  lastMowedAt: string | null;
  dueDate: string | null;
  nextCheckDate: string | null;
  targetCutHeightInches: number | null;
  equipmentGroup: string | null;
};

export type MowingCardViewModel = {
  family: "Mow";
  route: string;
  place: string;
  recurrence: {
    last: string | null;
    current: string | null;
    next: string | null;
  };
  height: {
    inches: number | null;
    label: string;
  };
  equipment: {
    label: string | null;
  };
};

function clean(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizedEquipmentLabel(value: string | null) {
  const label = clean(value);
  if (!label) return null;
  const lower = label.toLowerCase();
  if (lower.includes("battery") && lower.includes("mower")) return "Battery-powered push mower";
  if (lower.includes("riding") && lower.includes("mower")) return "Riding mower";
  return label;
}

export function buildMowingCardViewModel(input: MowingCardCanonicalInput): MowingCardViewModel {
  const inches = Number.isFinite(input.targetCutHeightInches) ? input.targetCutHeightInches : null;
  return {
    family: "Mow",
    route: clean(input.routeLabel) || "Mowing route",
    place: clean(input.zoneLabel) || "Elm Farm",
    recurrence: {
      last: clean(input.lastMowedAt),
      current: clean(input.dueDate),
      next: clean(input.nextCheckDate),
    },
    height: {
      inches,
      label: inches === null ? "Height not recorded" : `${inches} in`,
    },
    equipment: {
      label: normalizedEquipmentLabel(input.equipmentGroup),
    },
  };
}
