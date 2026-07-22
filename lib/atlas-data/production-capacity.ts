import { createAtlasServerClient } from "@/lib/supabase/server";

type AtlasServerClient = Awaited<ReturnType<typeof createAtlasServerClient>>;

export type CapacityQuestion = {
  id: string;
  stableKey: string;
  kind: string;
  question: string;
  answerValue: number | null;
  answerUnit: string | null;
  answerText: string | null;
  status: "open" | "answered" | "retired";
  answeredAt: string | null;
  metadata: Record<string, unknown>;
};

export type CapacityReservation = {
  id: string;
  poolId: string;
  poolLabel: string;
  quantityReserved: number;
  unit: string;
  windowStart: string;
  windowEnd: string;
  status: string;
};

export type CapacityRequirement = {
  id: string;
  stableKey: string;
  capacityKind: string;
  quantityNeeded: number | null;
  unit: string;
  requiredByDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  preparationDueDate: string | null;
  status: string;
  reservations: CapacityReservation[];
};

export type ProductionBedAssignment = {
  id: string;
  objectId: string;
  objectLabel: string;
  zoneLabel: string;
  quantityAssigned: number;
  unit: string;
  plannedTransplantDate: string;
  expectedReleaseDate: string | null;
  status: string;
  preparationTaskId: string | null;
};

export type CapacityProductionLot = {
  id: string;
  stableKey: string;
  label: string;
  successionNumber: number;
  plannedSeedQuantity: number | null;
  plannedSowDate: string | null;
  transplantStart: string | null;
  transplantEnd: string | null;
  requirements: CapacityRequirement[];
  bedAssignments: ProductionBedAssignment[];
};

export type CapacityPool = {
  id: string;
  stableKey: string;
  label: string;
  kind: string;
  totalCapacity: number | null;
  unit: string;
  status: string;
  resourceId: string | null;
  objectId: string | null;
};

export type BedCandidate = {
  id: string;
  stableKey: string;
  label: string;
  zoneId: string;
  zoneLabel: string;
  lengthFt: number;
  widthFt: number | null;
  managementGroup: string | null;
};

export type CapacityConflict = {
  poolId: string;
  poolKey: string;
  poolLabel: string;
  date: string;
  totalCapacity: number | null;
  reservedQuantity: number;
  remainingCapacity: number | null;
  unknownOrOverbooked: boolean;
};

export type OwnerProductionCapacitySnapshot = {
  program: {
    id: string;
    stableKey: string;
    label: string;
    seasonYear: number;
    promise: string | null;
    status: string;
  };
  summary: {
    openQuestions: number;
    answeredQuestions: number;
    blockedRequirements: number;
    calculatedRequirements: number;
    activeReservations: number;
    bedAssignments: number;
    capacityConflicts: number;
  };
  questions: CapacityQuestion[];
  pools: CapacityPool[];
  lots: CapacityProductionLot[];
  bedCandidates: BedCandidate[];
  conflicts: CapacityConflict[];
};

export async function loadOwnerProductionCapacity(
  supabase: AtlasServerClient,
  farmId: string,
): Promise<OwnerProductionCapacitySnapshot> {
  const { data, error } = await supabase.rpc(
    "owner_production_capacity_snapshot_v1",
    { p_farm_id: farmId },
  );

  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Production capacity snapshot was unavailable.");
  }

  return data as unknown as OwnerProductionCapacitySnapshot;
}
