import { NextResponse } from "next/server";

import { normalizePersonLifeCaptureInput } from "@/lib/atlas/person-life-capture-core.js";
import {
  buildFiveKGuardrailCapture,
  buildFiveKRequirementCapture,
  buildFiveKRhythmPlanCapture,
  buildRunDistanceCapture,
  fiveKGuardrailDefinitionForGoal,
  getFiveKRunSubject,
  hasFiveKRequirement,
  isFiveKGoal,
} from "@/lib/atlas/person-life-training-core.js";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };
type Subject = { domain?: string; kind?: string; id?: string };

type LifeDefinition = {
  definitionId: string;
  signalKind: string;
  status: string;
  subject?: Subject;
  lifeSignal?: {
    subject?: Subject;
    state?: Record<string, unknown>;
    requirements?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  createdAt?: string;
};

type ConsequenceInstance = {
  instanceId: string;
  definitionId: string;
  stableKey?: string;
  status: string;
  evidence?: Record<string, unknown> | null;
};

type PersonLifeState = {
  definitions?: LifeDefinition[];
  consequenceInstances?: ConsequenceInstance[];
  truthBoundary?: Record<string, unknown>;
};

type RhythmOpportunity = {
  opportunityId: string;
  bindingId: string;
  rhythmDefinitionId: string;
  localDate: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  projectionState: "projected" | "satisfied" | "elapsed" | "withdrawn";
  presentationState: "base" | "adapted" | "held" | "withdrawn";
  basePresentation?: Record<string, unknown>;
  presentationOverlay?: Record<string, unknown>;
  effectivePresentation?: Record<string, unknown>;
  planClaimId: string;
  planEvidenceId: string;
  satisfaction?: {
    evidenceId?: string;
    claimId?: string;
    eventId?: string;
    satisfiedAt?: string;
  } | null;
  presentationProvenance?: {
    consequenceInstanceId?: string;
    consequenceEventId?: string;
    appliedAt?: string;
  } | null;
};

type RhythmOpportunityRead = {
  opportunities?: RhythmOpportunity[];
  truthBoundary?: Record<string, unknown>;
};

type PersonClaim = {
  claimId: string;
  subject?: Subject;
  claimType: string;
  lifecycleState: string;
  authorityKind?: string;
  value?: Record<string, unknown> | null;
  primaryEvidenceId?: string;
  validFrom?: string | null;
  validUntil?: string | null;
};

type ClaimEvidenceState = {
  currentClaims?: PersonClaim[];
  truthBoundary?: Record<string, unknown>;
};

type CareCurrentStateRow = {
  subject_domain: string;
  subject_kind: string;
  subject_id: string;
  condition_state: string;
  disposition: string;
  last_observed_at: string;
  metadata: Record<string, unknown> | null;
};

type PersonLifeRequest = {
  action?: unknown;
  sourceKey?: unknown;
  acceptedAt?: unknown;
  observedAt?: unknown;
  goalDefinitionId?: unknown;
  opportunityId?: unknown;
  distanceKm?: unknown;
  timezone?: unknown;
  weekdays?: unknown;
  localStartTime?: unknown;
  windowMinutes?: unknown;
  [key: string]: unknown;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "person-life-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return privateJson({ ok: false, error: "Sign in required." }, 401);
  }
  if (error.code === "22023" || error.code === "23514") {
    return privateJson({ ok: false, error: error.message ?? "Atlas rejected this person-life transition." }, 400);
  }
  if (error.code === "23505" || error.code === "40001") {
    return privateJson({ ok: false, error: error.message ?? "Person-life state changed. Refresh and try again." }, 409);
  }
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") {
    return privateJson(
      { ok: false, error: "Person-owned Life Intelligence is not live in this database yet.", code: "person_life_not_live" },
      503,
    );
  }
  console.error("Atlas person-life RPC failed:", error);
  return privateJson({ ok: false, error: "Atlas could not update person-owned life state." }, 500);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function lifeState(data: unknown): PersonLifeState {
  return data && typeof data === "object" ? data as PersonLifeState : {};
}

function claimEvidenceState(data: unknown): ClaimEvidenceState {
  return data && typeof data === "object" ? data as ClaimEvidenceState : {};
}

function opportunityRows(data: unknown): RhythmOpportunity[] {
  if (!data || typeof data !== "object") return [];
  const rows = (data as RhythmOpportunityRead).opportunities;
  return Array.isArray(rows) ? rows : [];
}

function definitionSubject(definition: LifeDefinition | null | undefined): Subject | null {
  const subject = definition?.subject ?? definition?.lifeSignal?.subject;
  const domain = text(subject?.domain);
  const kind = text(subject?.kind);
  const id = text(subject?.id);
  return domain && kind && id ? { domain, kind, id } : null;
}

function activeFiveKGoal(state: PersonLifeState, requestedDefinitionId = "") {
  const definitions = state.definitions ?? [];
  const active = definitions.filter((definition) => isFiveKGoal(definition));
  if (requestedDefinitionId) {
    const exact = active.find((definition) => definition.definitionId === requestedDefinitionId);
    if (exact) return exact;
  }
  return active.at(-1) ?? null;
}

function sameGoalSubject(a: LifeDefinition | null, b: LifeDefinition | undefined) {
  const left = definitionSubject(a);
  const right = definitionSubject(b);
  return Boolean(left && right
    && left.domain === right.domain
    && left.kind === right.kind
    && left.id === right.id);
}

async function readPersonLife(supabase: Awaited<ReturnType<typeof createAtlasServerClient>>) {
  const { data, error } = await supabase.rpc("person_life_state_api_v1");
  return { data: lifeState(data), error };
}

async function readRhythmOpportunities(supabase: Awaited<ReturnType<typeof createAtlasServerClient>>) {
  const { data, error } = await supabase.rpc("person_rhythm_opportunities_self_api_v1", { p_limit: 60 });
  return { data: opportunityRows(data), envelope: data as RhythmOpportunityRead | null, error };
}

async function readClaimEvidence(supabase: Awaited<ReturnType<typeof createAtlasServerClient>>) {
  const { data, error } = await supabase.rpc("person_claim_evidence_state_api_v1");
  return { data: claimEvidenceState(data), error };
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  const supabase = await createAtlasServerClient();
  const [lifeRead, opportunityRead, claimRead, conditionRead] = await Promise.all([
    readPersonLife(supabase),
    readRhythmOpportunities(supabase),
    readClaimEvidence(supabase),
    supabase
      .from("care_current_state")
      .select("subject_domain, subject_kind, subject_id, condition_state, disposition, last_observed_at, metadata")
      .eq("scope_kind", "person")
      .eq("scope_id", session.userId)
      .order("last_observed_at", { ascending: false })
      .limit(50),
  ]);

  if (lifeRead.error) return rpcFailure(lifeRead.error as RpcError);
  if (opportunityRead.error) return rpcFailure(opportunityRead.error as RpcError);
  if (claimRead.error) return rpcFailure(claimRead.error as RpcError);
  if (conditionRead.error) {
    console.error("Atlas person condition read failed:", conditionRead.error);
    return privateJson({ ok: false, error: "Atlas could not read person condition state." }, 500);
  }

  return privateJson({
    ok: true,
    personLife: lifeRead.data,
    rhythmOpportunities: opportunityRead.data,
    rhythmTruthBoundary: opportunityRead.envelope?.truthBoundary ?? null,
    currentClaims: claimRead.data.currentClaims ?? [],
    conditions: (conditionRead.data ?? []) as CareCurrentStateRow[],
  });
}

export async function POST(request: Request) {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "Sign in required." }, 401);

  let body: PersonLifeRequest;
  try {
    body = await request.json() as PersonLifeRequest;
  } catch {
    return privateJson({ ok: false, error: "Capture payload must be valid JSON." }, 400);
  }

  const action = text(body.action);
  const supabase = await createAtlasServerClient();

  if (action === "goal" || action === "condition_observation") {
    const normalized = normalizePersonLifeCaptureInput(body, session.userId);
    if (!normalized.ok || !normalized.value) {
      return privateJson({ ok: false, error: normalized.error ?? "Invalid person-life capture." }, 400);
    }

    if (action === "goal") {
      const { data, error } = await supabase.rpc("create_person_life_definition_api_v1", {
        p_payload: normalized.value,
      });
      if (error) return rpcFailure(error as RpcError);
      return privateJson({ ok: true, action: "goal", result: data });
    }

    const { data, error } = await supabase.rpc("record_person_condition_observation_api_v1", {
      p_payload: normalized.value,
    });
    if (error) return rpcFailure(error as RpcError);
    return privateJson({ ok: true, action: "condition_observation", result: data });
  }

  const sourceKey = text(body.sourceKey);
  const acceptedAt = text(body.acceptedAt);
  const requestedGoalId = text(body.goalDefinitionId);
  if (!sourceKey) return privateJson({ ok: false, error: "sourceKey is required." }, 400);

  const currentRead = await readPersonLife(supabase);
  if (currentRead.error) return rpcFailure(currentRead.error as RpcError);
  const currentState = currentRead.data;
  const goal = activeFiveKGoal(currentState, requestedGoalId);

  if (action === "accept_five_k_measurement") {
    if (!acceptedAt) return privateJson({ ok: false, error: "acceptedAt is required." }, 400);

    if (!goal) {
      const requested = (currentState.definitions ?? []).find((definition) => definition.definitionId === requestedGoalId);
      const replacement = (currentState.definitions ?? []).filter((definition) => isFiveKGoal(definition)).at(-1);
      if (requested && replacement && sameGoalSubject(requested, replacement) && hasFiveKRequirement(replacement)) {
        return privateJson({ ok: true, action, replayed: true, goalDefinitionId: replacement.definitionId });
      }
      return privateJson({ ok: false, error: "An active person-owned 5K Goal is required." }, 400);
    }
    if (hasFiveKRequirement(goal)) {
      return privateJson({ ok: true, action, replayed: true, goalDefinitionId: goal.definitionId });
    }

    const goalSubject = definitionSubject(goal);
    const built = buildFiveKRequirementCapture({
      goalSubject,
      sourceKey: `${sourceKey}:requirement`,
      observedAt: acceptedAt,
    });
    if (!built.ok || !built.value) return privateJson({ ok: false, error: built.error ?? "Invalid 5K measurement acceptance." }, 400);

    const captured = await supabase.rpc("record_person_claim_evidence_api_v1", {
      p_payload: built.value.capture,
    });
    if (captured.error) return rpcFailure(captured.error as RpcError);
    const claimId = text((captured.data as Record<string, unknown> | null)?.claimId);
    if (!claimId) return privateJson({ ok: false, error: "Atlas did not return the accepted measurement Claim." }, 500);

    const revised = await supabase.rpc("revise_person_goal_from_accepted_requirement_api_v1", {
      p_payload: {
        sourceKey: `${sourceKey}:goal_revision`,
        definitionId: goal.definitionId,
        acceptedRequirementClaimId: claimId,
        reason: "Person explicitly accepted 5 km as the measurement for this 5K Goal.",
      },
    });
    if (revised.error) return rpcFailure(revised.error as RpcError);

    return privateJson({ ok: true, action, requirementClaim: captured.data, goalRevision: revised.data });
  }

  if (!goal || !hasFiveKRequirement(goal)) {
    return privateJson({ ok: false, error: "Accept the 5 km Goal measurement before adding training behavior." }, 400);
  }

  if (action === "accept_five_k_rhythm") {
    if (!acceptedAt) return privateJson({ ok: false, error: "acceptedAt is required." }, 400);
    const runSubject = getFiveKRunSubject(goal);
    const timezone = text(body.timezone);
    const built = buildFiveKRhythmPlanCapture({
      goalDefinitionId: goal.definitionId,
      goalSubject: definitionSubject(goal),
      runSubject,
      sourceKey: `${sourceKey}:plan`,
      acceptedAt,
      timezone,
      weekdays: Array.isArray(body.weekdays) ? body.weekdays : [1, 3, 5],
      localStartTime: text(body.localStartTime) || "17:00",
      windowMinutes: body.windowMinutes ?? 90,
    });
    if (!built.ok || !built.value) return privateJson({ ok: false, error: built.error ?? "Invalid training cadence acceptance." }, 400);

    const captured = await supabase.rpc("record_person_claim_evidence_api_v1", { p_payload: built.value.capture });
    if (captured.error) return rpcFailure(captured.error as RpcError);
    const claimId = text((captured.data as Record<string, unknown> | null)?.claimId);
    if (!claimId) return privateJson({ ok: false, error: "Atlas did not return the accepted Rhythm plan Claim." }, 500);

    const activated = await supabase.rpc("activate_person_goal_rhythm_plan_api_v1", { p_plan_claim_id: claimId });
    if (activated.error) return rpcFailure(activated.error as RpcError);
    return privateJson({ ok: true, action, planClaim: captured.data, activation: activated.data });
  }

  if (action === "accept_five_k_guardrail") {
    if (!acceptedAt) return privateJson({ ok: false, error: "acceptedAt is required." }, 400);
    const existing = fiveKGuardrailDefinitionForGoal(currentState.definitions ?? [], goal.definitionId);
    if (existing) {
      return privateJson({ ok: true, action, replayed: true, definitionId: existing.definitionId });
    }

    const built = buildFiveKGuardrailCapture({
      ownerUserId: session.userId,
      goalDefinitionId: goal.definitionId,
      sourceKey: `${sourceKey}:policy`,
      acceptedAt,
    });
    if (!built.ok || !built.value) return privateJson({ ok: false, error: built.error ?? "Invalid knee-response guardrail acceptance." }, 400);

    const captured = await supabase.rpc("record_person_claim_evidence_api_v1", { p_payload: built.value.policyCapture });
    if (captured.error) return rpcFailure(captured.error as RpcError);
    const claimId = text((captured.data as Record<string, unknown> | null)?.claimId);
    const definitionPayload = built.value.buildDefinition(claimId);
    if (!definitionPayload) return privateJson({ ok: false, error: "Atlas did not return the accepted guardrail Claim." }, 500);

    const definition = await supabase.rpc("create_person_life_definition_api_v1", { p_payload: definitionPayload });
    if (definition.error) return rpcFailure(definition.error as RpcError);
    return privateJson({ ok: true, action, policyClaim: captured.data, definition: definition.data });
  }

  if (action === "record_five_k_run") {
    const observedAt = text(body.observedAt);
    const opportunityId = text(body.opportunityId);
    const runSubject = getFiveKRunSubject(goal);
    const built = buildRunDistanceCapture({
      runSubject,
      sourceKey: `${sourceKey}:run`,
      observedAt,
      distanceKm: body.distanceKm,
    });
    if (!built.ok || !built.value) return privateJson({ ok: false, error: built.error ?? "Invalid run observation." }, 400);
    if (!opportunityId) return privateJson({ ok: false, error: "Choose the accepted Rhythm opportunity this run satisfies." }, 400);

    const [opportunityRead, claimRead] = await Promise.all([
      readRhythmOpportunities(supabase),
      readClaimEvidence(supabase),
    ]);
    if (opportunityRead.error) return rpcFailure(opportunityRead.error as RpcError);
    if (claimRead.error) return rpcFailure(claimRead.error as RpcError);

    const opportunity = opportunityRead.data.find((item) => item.opportunityId === opportunityId);
    const planClaim = (claimRead.data.currentClaims ?? []).find((claim) => {
      if (claim.claimId !== opportunity?.planClaimId || claim.claimType !== "goal_rhythm_plan") return false;
      const value = claim.value ?? {};
      return value.goalDefinitionId === goal.definitionId && value.goalRequirementKey === "complete_5k";
    });
    if (!opportunity || !planClaim) {
      return privateJson({ ok: false, error: "That run window is not a current accepted opportunity for this 5K Goal." }, 400);
    }

    const occurrence = await supabase.rpc("record_person_rhythm_occurrence_api_v1", {
      p_opportunity_id: opportunityId,
      p_payload: {
        sourceKey: `${sourceKey}:occurrence`,
        observedAt,
        evidenceKind: "run_distance",
        value: built.value.claim.value,
        metadata: { captureSurface: "person_life_5k_notebook" },
      },
    });
    if (occurrence.error) return rpcFailure(occurrence.error as RpcError);
    return privateJson({ ok: true, action, occurrence: occurrence.data });
  }

  if (action === "record_five_k_knee_observation") {
    const observedAt = text(body.observedAt);
    if (!observedAt) return privateJson({ ok: false, error: "observedAt is required." }, 400);

    const normalized = normalizePersonLifeCaptureInput({
      action: "condition_observation",
      sourceKey: `${sourceKey}:right_knee`,
      bodyRegion: "right knee",
      observation: "aching after mile 2",
      observedAt,
    }, session.userId);
    if (!normalized.ok || !normalized.value) {
      return privateJson({ ok: false, error: normalized.error ?? "Invalid knee observation." }, 400);
    }

    const observation = await supabase.rpc("record_person_condition_observation_api_v1", { p_payload: normalized.value });
    if (observation.error) return rpcFailure(observation.error as RpcError);
    const evidenceId = text((observation.data as Record<string, unknown> | null)?.evidenceId);
    if (!evidenceId) return privateJson({ ok: false, error: "Atlas did not return canonical Evidence for the knee observation." }, 500);

    const guardrail = fiveKGuardrailDefinitionForGoal(currentState.definitions ?? [], goal.definitionId);
    if (!guardrail) {
      return privateJson({ ok: true, action, observation: observation.data, evaluation: null, adaptation: null });
    }

    const evaluation = await supabase.rpc("evaluate_person_consequence_from_evidence_api_v1", {
      p_definition_id: guardrail.definitionId,
      p_payload: { sourceKey: `${sourceKey}:consequence_evaluation`, evidenceId },
    });
    if (evaluation.error) return rpcFailure(evaluation.error as RpcError);

    const afterEvaluation = await readPersonLife(supabase);
    if (afterEvaluation.error) return rpcFailure(afterEvaluation.error as RpcError);
    const instance = (afterEvaluation.data.consequenceInstances ?? []).find((item) => {
      if (item.definitionId !== guardrail.definitionId || item.status !== "open") return false;
      return (item.evidence as { evidenceId?: unknown } | null)?.evidenceId === evidenceId;
    });

    if (!instance) {
      return privateJson({ ok: true, action, observation: observation.data, evaluation: evaluation.data, adaptation: null });
    }

    const adaptation = await supabase.rpc("apply_person_consequence_to_next_rhythm_opportunity_api_v1", {
      p_consequence_instance_id: instance.instanceId,
    });
    if (adaptation.error) return rpcFailure(adaptation.error as RpcError);

    return privateJson({
      ok: true,
      action,
      observation: observation.data,
      evaluation: evaluation.data,
      consequenceInstanceId: instance.instanceId,
      adaptation: adaptation.data,
    });
  }

  return privateJson({ ok: false, error: "Unsupported person-life capture type." }, 400);
}
