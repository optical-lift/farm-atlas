import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasPrincipalPortfolioUnit = {
  id: string;
  stableKey: string;
  name: string;
  unitKind: string;
  linkedFarmId: string | null;
  lifecycleState: string;
  portfolioRole: string | null;
  horizon: "H1" | "H2" | "H3" | string | null;
  archivedAt: string | null;
};

export type AtlasPrincipalHousehold = {
  id: string;
  principal_id: string;
  stable_key: string;
  name: string;
  timezone: string;
  status: string;
  metadata?: Record<string, unknown> | null;
};

export type AtlasPrincipalCapacityState = {
  state: string;
  capacityKnown?: boolean;
  reason?: string | null;
  timezone?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  elapsedMinutes?: number | null;
  blockedMinutes?: number | null;
  availableElapsedMinutes?: number | null;
  discretionaryCapacityMinutes?: number | null;
  maximumPlannedMinutes?: number | null;
};

export type AtlasPrincipalClockFloor = {
  title?: string | null;
  domain?: string | null;
  source_type?: string | null;
  floor_class?: number | null;
  timing_state?: string | null;
  consequence?: string | null;
  reason_for_floor?: string | null;
  expected_minutes?: number | null;
  horizon?: string | null;
  placement_state?: string | null;
};

export type AtlasPrincipalClock = {
  state: string;
  serviceDate?: string | null;
  asOf?: string | null;
  allocationState?: string | null;
  capacity?: AtlasPrincipalCapacityState | null;
  floor?: AtlasPrincipalClockFloor | null;
  candidates?: AtlasPrincipalClockFloor[];
};

export type AtlasPrincipalClockCandidate = {
  domain: string;
  sourceType: string;
  sourceId: string;
  title: string;
  floorClass: number;
  windowStart: string | null;
  windowEnd: string | null;
  fixedStart: string | null;
  mustBeginBy: string | null;
  mustFinishBy: string | null;
  expectedMinutes: number | null;
  protectionLevel: string | null;
  ownerRequired: boolean;
  consequence: string | null;
  reasonForFloor: string | null;
  portfolioUnitId: string | null;
  horizon: string | null;
};

export type AtlasPrincipalAttentionItem = {
  subjectId?: string;
  subjectStableKey?: string;
  subjectType?: string;
  title?: string;
  portfolioUnitId?: string | null;
  horizon?: string | null;
  cadenceDays?: number | null;
  protectedOwnerMinutes?: number | null;
  floorClass?: number | null;
  protectionLevel?: string | null;
  lastMeaningfulAt?: string | null;
  nextDueAt?: string | null;
  attentionState?: string | null;
  attentionDebtDays?: number | null;
  consequence?: string | null;
  reasonForFloor?: string | null;
};

export type AtlasPrincipalPortfolioThesis = {
  id: string;
  stableKey: string;
  portfolioUnitId: string;
  portfolioUnitStableKey: string;
  portfolioUnitName: string;
  horizon: string | null;
  thesisStatement: string | null;
  valueCreationLogic: string | null;
  mustBecomeTrue: unknown;
  capitalRequired: unknown;
  nextValueMilestone: string | null;
  assumptions: unknown;
  reconsiderationConditions: unknown;
  reviewCadenceDays: number | null;
  nextReviewAt: string | null;
  status: string;
  source: string | null;
};

export type AtlasPrincipalOperatingFunction = {
  id: string;
  stableKey: string;
  name: string;
  charter: string | null;
  portfolioUnitId: string | null;
  accountablePersonId: string | null;
  capacityState: string | null;
  reviewCadenceDays: number | null;
  active: boolean;
  source: string | null;
};

export type AtlasPrincipalGreatGameScore = {
  scorecardId: string;
  stableKey: string;
  name: string;
  criticalNumber: unknown;
  drivers: unknown;
  operatingFunctionId: string | null;
  functionName: string | null;
  portfolioUnitId: string | null;
  portfolioUnitName: string | null;
  horizon: string | null;
  accountableOperatorId: string | null;
  asOf: string | null;
  actual: unknown;
  forecast: unknown;
  target: unknown;
  trend: string | null;
  nextPlay: string | null;
  measurementState: string | null;
};

export type AtlasPrincipalCapitalRequest = {
  id: string;
  stableKey: string;
  title: string;
  portfolioUnitId: string | null;
  amount: number | null;
  currency: string;
  neededBy: string | null;
  reason: string | null;
  status: string;
};

export type AtlasPrincipalInvestmentOpportunity = {
  id: string;
  stableKey: string;
  title: string;
  portfolioUnitId: string | null;
  capitalRequired: number | null;
  currency: string;
  readinessState: string | null;
  nextValueMilestone: string | null;
  status: string;
};

export type AtlasHousePosition = {
  state: string;
  asOf?: string | null;
  source?: string | null;
  freshness?: string | null;
  coverage?: {
    state?: string | null;
    start?: string | null;
    end?: string | null;
    includedEntities?: unknown[];
    includedAccounts?: unknown[];
  } | null;
  currencySummaries?: Array<{
    currency?: string;
    liquidResources?: number | null;
    committedOutflows30?: number | null;
    expectedInflows30?: number | null;
    projectedLiquidity30?: number | null;
    committedOutflows60?: number | null;
    expectedInflows60?: number | null;
    projectedLiquidity60?: number | null;
    committedOutflows90?: number | null;
    expectedInflows90?: number | null;
    projectedLiquidity90?: number | null;
    recurringObligationsRecorded?: number | null;
    committedCapitalRecorded?: number | null;
  }>;
  capitalRequests?: AtlasPrincipalCapitalRequest[];
  investmentOpportunities?: AtlasPrincipalInvestmentOpportunity[];
};

export type AtlasPrincipalOffice = {
  state: string;
  portfolioTheses?: AtlasPrincipalPortfolioThesis[];
  attention?: AtlasPrincipalAttentionItem[];
  operatingFunctions?: AtlasPrincipalOperatingFunction[];
  greatGame?: AtlasPrincipalGreatGameScore[];
  housePosition?: AtlasHousePosition | null;
};

export type AtlasPrincipalCapabilityHoldItem = {
  taskId: string;
  title: string;
  taskType: string | null;
  actionKey: string | null;
  status: string;
  dueDate: string | null;
  farmId: string;
  portfolioUnitId: string;
  portfolioUnitName: string;
  portfolioHorizon: string | null;
  assignedMembershipId: string | null;
  assignedWorkerKey: string | null;
  assignedRole: string | null;
  readinessKey: string | null;
  readinessLabel: string | null;
  blocker: string | null;
  holdDimensions: string[];
  heldSince: string | null;
  lastChangedAt: string | null;
  originalDueDate: string | null;
};

export type AtlasPrincipalCapabilityHolds = {
  contractVersion?: string;
  state: string;
  count: number;
  items: AtlasPrincipalCapabilityHoldItem[];
  truthBoundary?: Record<string, unknown>;
};

export type AtlasPrincipalSelfContext = {
  contractVersion?: string;
  state: string;
  principal?: {
    id: string;
    stableKey: string;
    name: string;
    organizationId: string | null;
    homeTimezone: string;
    activeHouseholdId: string | null;
  } | null;
  household?: AtlasPrincipalHousehold | null;
  portfolioUnits?: AtlasPrincipalPortfolioUnit[];
  clockCandidatesMode?: string;
  clockCandidates?: AtlasPrincipalClockCandidate[];
  principalClock?: AtlasPrincipalClock | null;
  principalOffice?: AtlasPrincipalOffice | null;
  capacityToday?: AtlasPrincipalCapacityState | null;
  capabilityHolds?: AtlasPrincipalCapabilityHolds | null;
};

export async function readAtlasPrincipalSelfContext(): Promise<AtlasPrincipalSelfContext> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("principal_self_context_api_v1");

  if (error) throw new Error(`Atlas Principal context read failed: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Atlas Principal context returned an invalid payload.");
  }

  return data as unknown as AtlasPrincipalSelfContext;
}
