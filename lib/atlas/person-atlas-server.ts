import "server-only";

import { assembleWorkerDaySequence, type AtlasDaySequence } from "@/lib/atlas/day-sequence";
import { readWorkerDayChoreographyForTarget } from "@/lib/atlas/day-choreography-server";
import { buildPersonAtlasProjection } from "@/lib/atlas/person-atlas-projection-core.js";
import type { AtlasSession } from "@/lib/atlas/session";
import { readWorkerSelfDayBundleForTarget } from "@/lib/atlas/worker-self-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type CompanyResponsibilityRow = {
  organization_id: string;
  organization_name: string;
  organization_unit_id: string | null;
  organization_unit_key: string | null;
  organization_unit_name: string | null;
  work_item_id: string;
  allocation_id: string;
  title: string;
  instructions: string | null;
  work_state: string;
  operation_class: string | null;
  allocation_role: string;
  allocated_at: string;
  requirements: unknown[] | Record<string, unknown>;
  next_target_at: string | null;
  execution_state: string;
  execution_reason: string | null;
  legacy_task_id: string | null;
  legacy_task_status: string | null;
  legacy_task_due_date: string | null;
  attention_lease_id: string | null;
  attention_lease_state: string | null;
};

type PersonClaim = {
  claimId: string;
  subject?: { domain?: string; kind?: string; id?: string };
  claimType: string;
  lifecycleState: string;
  authorityKind?: string;
  value?: Record<string, unknown> | null;
  primaryEvidenceId?: string;
  validFrom?: string | null;
  validUntil?: string | null;
};

type RhythmOpportunity = {
  opportunityId: string;
  localDate: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  projectionState: "projected" | "satisfied" | "elapsed" | "withdrawn";
  presentationState: "base" | "adapted" | "held" | "withdrawn";
  basePresentation?: Record<string, unknown>;
  effectivePresentation?: Record<string, unknown>;
};

type ClaimEnvelope = { currentClaims?: PersonClaim[] };
type RhythmEnvelope = { opportunities?: RhythmOpportunity[] };
type RpcError = { code?: string; message?: string };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isOptionalPersonAuthorityMissing(error: RpcError | null) {
  return Boolean(error && ["PGRST202", "42883", "42P01"].includes(error.code ?? ""));
}

function activeFarmHandMembership(session: AtlasSession) {
  if (session.activeFarmId) {
    const active = session.memberships.find((membership) => membership.farmId === session.activeFarmId);
    if (active?.role === "farm_hand") return active;
    return null;
  }
  const workers = session.memberships.filter((membership) => membership.role === "farm_hand");
  return workers.length === 1 ? workers[0] : null;
}

async function readWorkerSelfSequence(session: AtlasSession, forDate: string): Promise<AtlasDaySequence | null> {
  const membership = activeFarmHandMembership(session);
  if (!membership) return null;

  const target = {
    farmId: membership.farmId,
    membershipId: membership.membershipId,
    displayName: session.displayName || "Farm Hand",
    source: "worker_self" as const,
  };

  try {
    const [bundle, choreography] = await Promise.all([
      readWorkerSelfDayBundleForTarget(forDate, target),
      readWorkerDayChoreographyForTarget(forDate, target),
    ]);
    const sameTarget = Boolean(
      choreography.active
      && choreography.target?.farmId === target.farmId
      && choreography.target?.membershipId === target.membershipId,
    );
    return assembleWorkerDaySequence({
      serviceDate: bundle.plan.serviceDate || forDate,
      realWork: bundle.plan.realWork,
      automaticWork: bundle.plan.automaticWork,
      suggestions: [],
      placements: sameTarget ? choreography.choreography?.placements ?? [] : [],
      cues: sameTarget ? choreography.choreography?.cues ?? [] : [],
    });
  } catch (error) {
    console.error("Atlas Person surface could not read Worker Day current move:", error);
    return null;
  }
}

export async function readPersonAtlasProjection(session: AtlasSession, forDate: string) {
  const supabase = await createAtlasServerClient();
  const [companyRead, claimRead, rhythmRead, daySequence] = await Promise.all([
    supabase.rpc("company_work_self_responsibilities_api_v1"),
    supabase.rpc("person_claim_evidence_state_api_v1"),
    supabase.rpc("person_rhythm_opportunities_self_api_v1", { p_limit: 60 }),
    readWorkerSelfSequence(session, forDate),
  ]);

  if (companyRead.error) {
    console.error("Atlas Company Work self-responsibility read failed:", companyRead.error);
    throw new Error("Atlas could not read your company responsibilities.");
  }

  let currentClaims: PersonClaim[] = [];
  if (claimRead.error) {
    if (!isOptionalPersonAuthorityMissing(claimRead.error as RpcError)) {
      console.error("Atlas person Claim read failed:", claimRead.error);
    }
  } else {
    const envelope = object(claimRead.data) as ClaimEnvelope;
    currentClaims = Array.isArray(envelope.currentClaims) ? envelope.currentClaims : [];
  }

  let rhythmOpportunities: RhythmOpportunity[] = [];
  if (rhythmRead.error) {
    if (!isOptionalPersonAuthorityMissing(rhythmRead.error as RpcError)) {
      console.error("Atlas person Rhythm read failed:", rhythmRead.error);
    }
  } else {
    const envelope = object(rhythmRead.data) as RhythmEnvelope;
    rhythmOpportunities = Array.isArray(envelope.opportunities) ? envelope.opportunities : [];
  }

  const companyResponsibilities = Array.isArray(companyRead.data)
    ? companyRead.data as CompanyResponsibilityRow[]
    : [];

  return buildPersonAtlasProjection({
    forDate,
    daySequence,
    companyResponsibilities,
    currentClaims,
    rhythmOpportunities,
  });
}
