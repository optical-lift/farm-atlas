import { createAtlasServerClient } from "@/lib/supabase/server";

export type PrincipalPortfolioUnit = {
  id: string;
  stableKey: string;
  name: string;
  unitKind: string;
  linkedFarmId: string | null;
  lifecycleState: string;
  portfolioRole: string;
  horizon: "H1" | "H2" | "H3" | string;
  archivedAt: string | null;
};

export type PrincipalCapacityState = {
  contractVersion?: string;
  state: string;
  reason?: string | null;
  principalId?: string | null;
  serviceDate?: string | null;
  capacityKnown?: boolean;
  availableMinutes?: number | null;
  committedMinutes?: number | null;
  protectedMinutes?: number | null;
  discretionaryMinutes?: number | null;
};

export type PrincipalClockClaim = {
  domain?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  title?: string | null;
  floorClass?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  fixedStart?: string | null;
  mustBeginBy?: string | null;
  mustFinishBy?: string | null;
  expectedMinutes?: number | null;
  protectionLevel?: string | null;
  ownerRequired?: boolean | null;
  consequence?: string | null;
  reasonForFloor?: string | null;
  portfolioUnitId?: string | null;
  horizon?: string | null;
  timingState?: string | null;
};

export type PrincipalClockState = {
  contractVersion?: string;
  state: string;
  serviceDate?: string | null;
  asOf?: string | null;
  allocationState?: string | null;
  capacity?: PrincipalCapacityState | null;
  candidates?: PrincipalClockClaim[];
  floor?: PrincipalClockClaim | null;
};

export type PrincipalHousePosition = {
  contractVersion?: string;
  state: string;
  asOf?: string | null;
  source?: string | null;
  freshness?: string | null;
  coverage?: {
    state?: string | null;
    start?: string | null;
    end?: string | null;
    includedAccounts?: unknown[];
    includedEntities?: unknown[];
  } | null;
  currencySummaries?: unknown[];
  capitalRequests?: unknown[];
  investmentOpportunities?: unknown[];
};

export type PrincipalOfficeState = {
  contractVersion?: string;
  state: string;
  portfolioTheses?: unknown[];
  attention?: unknown[];
  operatingFunctions?: unknown[];
  greatGame?: unknown[];
  housePosition?: PrincipalHousePosition | null;
};

export type PrincipalSelfContext = {
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
  household?: {
    id?: string;
    stable_key?: string;
    name?: string;
    timezone?: string;
    status?: string;
  } | null;
  portfolioUnits?: PrincipalPortfolioUnit[];
  clockCandidatesMode?: string;
  clockCandidates?: PrincipalClockClaim[];
  principalClock?: PrincipalClockState | null;
  principalOffice?: PrincipalOfficeState | null;
  capacityToday?: PrincipalCapacityState | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function readPrincipalSelfContext(): Promise<PrincipalSelfContext> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("principal_self_context_api_v1");

  if (error) {
    throw new Error(`Principal context read failed: ${error.message}`);
  }
  if (!isRecord(data)) {
    throw new Error("Principal context returned an invalid contract.");
  }

  return data as PrincipalSelfContext;
}
