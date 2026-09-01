import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasPrincipalDecisionCommand = {
  kind: string;
  contractVersion?: string | null;
  targetKind: string;
  targetId: string;
};

export type AtlasPrincipalDecisionCandidate = {
  candidateKey: string;
  principalId?: string | null;
  scope?: {
    kind?: string | null;
    id?: string | null;
    organizationId?: string | null;
    portfolioUnitId?: string | null;
  } | null;
  source?: {
    domain?: string | null;
    kind?: string | null;
    id?: string | null;
    state?: Record<string, unknown> | null;
  } | null;
  decisionKind?: string | null;
  prompt?: string | null;
  options?: unknown[];
  command?: AtlasPrincipalDecisionCommand | null;
  authority?: {
    principalRequired?: boolean;
    basis?: string | null;
    executionAuthority?: string | null;
  } | null;
  admission?: {
    state?: string | null;
    basis?: string | null;
    consequence?: string | null;
    reasonForFloor?: string | null;
    escalationId?: string | null;
  } | null;
  resolution?: {
    state?: string | null;
    sourceKind?: string | null;
    sourceId?: string | null;
  } | null;
  timing?: {
    windowStart?: string | null;
    windowEnd?: string | null;
    expectedPrincipalMinutes?: number | null;
    floorClass?: number | null;
    protectionLevel?: string | null;
    interruptibility?: string | null;
  } | null;
  presentation?: {
    title?: string | null;
    summary?: string | null;
  } | null;
  metadata?: Record<string, unknown> | null;
  truthBoundary?: Record<string, unknown> | null;
};

export type AtlasPrincipalDecisionFeed = {
  contractVersion?: string;
  state: string;
  principalId?: string | null;
  coverageState?: string | null;
  coverageMode?: string | null;
  completeFieldClaim?: boolean;
  sourceCount?: number;
  candidateCount?: number;
  translationRequiredCount?: number;
  containedCount?: number;
  sourceResolvedCount?: number;
  candidates: AtlasPrincipalDecisionCandidate[];
  translationRequired?: unknown[];
  contained?: unknown[];
  sourceResolved?: unknown[];
  truthBoundary?: Record<string, unknown> | null;
};

export async function readAtlasPrincipalDecisionPackets(): Promise<AtlasPrincipalDecisionFeed> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("principal_decision_packets_api_v1");

  if (error) throw new Error(`Atlas Principal decision read failed: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Atlas Principal decision read returned an invalid payload.");
  }

  const feed = data as unknown as AtlasPrincipalDecisionFeed;
  return {
    ...feed,
    candidates: Array.isArray(feed.candidates) ? feed.candidates : [],
  };
}
