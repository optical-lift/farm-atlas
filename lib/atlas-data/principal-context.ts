import { createAtlasServerClient } from "@/lib/supabase/server";

export type PrincipalPortfolioUnit = {
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

export type PrincipalClockCandidate = {
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

export type PrincipalClockFloor = {
  domain?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  title?: string | null;
  floor_class?: number | null;
  timing_state?: string | null;
  reason_for_floor?: string | null;
  consequence?: string | null;
  expected_minutes?: number | null;
  horizon?: string | null;
} | null;

export type PrincipalClockContext = {
  contractVersion: string;
  state: string;
  serviceDate?: string;
  asOf?: string;
  allocationState?: string;
  capacity?: Record<string, unknown> | null;
  floor?: PrincipalClockFloor;
  candidates?: Array<Record<string, unknown>>;
};

export type PrincipalAttentionItem = {
  subjectId: string;
  subjectStableKey: string;
  subjectType: string;
  title: string;
  portfolioUnitId: string | null;
  horizon: string | null;
  cadenceDays: number | null;
  protectedOwnerMinutes: number | null;
  floorClass: number | null;
  protectionLevel: string | null;
  lastMeaningfulAt: string | null;
  nextDueAt: string | null;
  attentionState: string | null;
  attentionDebtDays: number | null;
  consequence: string | null;
  reasonForFloor: string | null;
};

export type PrincipalOperatingFunction = {
  id: string;
  stableKey: string;
  name: string;
  charter: string | null;
  portfolioUnitId: string | null;
  accountablePersonId: string | null;
  capacityState: string | null;
  reviewCadenceDays: number | null;
  active: boolean;
};

export type PrincipalPortfolioThesis = {
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
  nextReviewAt: string | null;
  status: string;
};

export type PrincipalGreatGameScore = {
  scorecardId: string;
  stableKey: string;
  name: string;
  criticalNumber: unknown;
  drivers: unknown;
  functionName: string | null;
  portfolioUnitName: string | null;
  horizon: string | null;
  asOf: string | null;
  actual: unknown;
  forecast: unknown;
  target: unknown;
  trend: string | null;
  nextPlay: string | null;
  measurementState: string | null;
};

export type HousePositionCurrencySummary = {
  currency: string;
  liquidResources: number | null;
  committedOutflows30: number | null;
  expectedInflows30: number | null;
  projectedLiquidity30: number | null;
  committedOutflows60: number | null;
  expectedInflows60: number | null;
  projectedLiquidity60: number | null;
  committedOutflows90: number | null;
  expectedInflows90: number | null;
  projectedLiquidity90: number | null;
  recurringObligationsRecorded: number | null;
  committedCapitalRecorded: number | null;
};

export type PrincipalHousePosition = {
  contractVersion: string;
  state: string;
  asOf?: string | null;
  source?: string | null;
  coverage?: {
    state?: string | null;
    start?: string | null;
    end?: string | null;
    includedEntities?: unknown[];
    includedAccounts?: unknown[];
  } | null;
  freshness?: string | null;
  currencySummaries?: HousePositionCurrencySummary[];
  capitalRequests?: Array<Record<string, unknown>>;
  investmentOpportunities?: Array<Record<string, unknown>>;
};

export type PrincipalOfficeContext = {
  contractVersion: string;
  state: string;
  portfolioTheses?: PrincipalPortfolioThesis[];
  attention?: PrincipalAttentionItem[];
  operatingFunctions?: PrincipalOperatingFunction[];
  greatGame?: PrincipalGreatGameScore[];
  housePosition?: PrincipalHousePosition;
};

export type PrincipalSelfContext = {
  contractVersion: string;
  state: "ready" | "principal_required" | string;
  principal?: {
    id: string;
    stableKey: string;
    name: string;
    organizationId: string | null;
    homeTimezone: string | null;
    activeHouseholdId: string | null;
  };
  household?: Record<string, unknown> | null;
  portfolioUnits?: PrincipalPortfolioUnit[];
  clockCandidatesMode?: string;
  clockCandidates?: PrincipalClockCandidate[];
  principalClock?: PrincipalClockContext;
  principalOffice?: PrincipalOfficeContext;
  capacityToday?: Record<string, unknown> | null;
};

export async function readPrincipalSelfContext(): Promise<PrincipalSelfContext> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("principal_self_context_api_v1");

  if (error) {
    throw new Error(`Principal context read failed: ${error.message}`);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Principal context returned an invalid payload.");
  }

  return data as unknown as PrincipalSelfContext;
}
