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

export type AtlasPrincipalAttentionItem = {
  subjectId?: string;
  title?: string;
  horizon?: string | null;
  nextDueAt?: string | null;
  attentionState?: string | null;
  attentionDebtDays?: number | null;
  protectedOwnerMinutes?: number | null;
  reasonForFloor?: string | null;
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
    projectedLiquidity30?: number | null;
    projectedLiquidity60?: number | null;
    projectedLiquidity90?: number | null;
  }>;
  capitalRequests?: unknown[];
  investmentOpportunities?: unknown[];
};

export type AtlasPrincipalOffice = {
  state: string;
  portfolioTheses?: unknown[];
  attention?: AtlasPrincipalAttentionItem[];
  operatingFunctions?: unknown[];
  greatGame?: unknown[];
  housePosition?: AtlasHousePosition | null;
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
  household?: Record<string, unknown> | null;
  portfolioUnits?: AtlasPrincipalPortfolioUnit[];
  clockCandidatesMode?: string;
  clockCandidates?: unknown[];
  principalClock?: AtlasPrincipalClock | null;
  principalOffice?: AtlasPrincipalOffice | null;
  capacityToday?: AtlasPrincipalCapacityState | null;
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
