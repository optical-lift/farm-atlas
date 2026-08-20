export type MowingCardResource = {
  label: string;
  status?: string | null;
  reason?: string | null;
};

export type MowingCardCanonicalInput = {
  routeLabel: string;
  zoneLabel: string;
  lastMowedAt: string | null;
  dueDate: string | null;
  nextCheckDate: string | null;
  targetCutHeightInches: number | null;
  equipmentGroup: string | null;
  resources?: MowingCardResource[];
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
    resources: MowingCardResource[];
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
      // Do not manufacture a future recurrence. The production card may show
      // "Next mow" only when Atlas has an actual canonical next-check date.
      next: clean(input.nextCheckDate),
    },
    height: {
      inches,
      label: inches === null ? "Height not recorded" : `${inches} in`,
    },
    equipment: {
      label: normalizedEquipmentLabel(input.equipmentGroup),
      // Resources are supplied by the canonical execution/readiness contract.
      // The specimen's Gas / 2 batteries labels are never fixture defaults here.
      resources: Array.isArray(input.resources)
        ? input.resources
            .map((resource) => ({
              label: clean(resource.label) || "Resource",
              status: clean(resource.status),
              reason: clean(resource.reason),
            }))
            .filter((resource) => resource.label !== "Resource" || resource.status || resource.reason)
        : [],
    },
  };
}
