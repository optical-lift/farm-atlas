import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAtlasSupabaseConfig } from "@/lib/supabase/config";

const MODEL = "openai/gpt-5.6-sol";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const MAX_QUESTION_LENGTH = 600;
const MAX_PROPOSAL_CARRIERS = 24;
const ORGANIZATION_KEY = "feast_guild";
const LOCAL_LENS_KEY = "noel_condition_bound_reality_v1";

const buckets = new Map<string, { count: number; resetAt: number }>();

type JsonPrimitive = string | number | boolean | null;

type EnvelopeOutput = {
  literal_request: string;
  request_mode: "open_composition" | "targeted_request";
  fact_items: Array<{
    key: string;
    value: JsonPrimitive;
    epistemic_status: "explicit";
    source_evidence: { kind: "literal_span"; text: string };
  }>;
  inferred_items: Array<{
    key: "delegated_composition";
    value: boolean;
    epistemic_status: "derived";
    basis: "open_ended_planning_request";
  }>;
  retrieval: {
    search_query: string;
    expansions: string[];
    city: string | null;
    date_start: string | null;
    date_end: string | null;
  };
};

type ProposalOutput = {
  proposal_version: "composition_proposal_v1";
  not_unique_moral_route: boolean;
  ordering_authority: "neutral_composition_policy" | "constraint_order" | "not_applicable";
  neutral_policy_key: string | null;
  not_unique_canon_order: boolean;
  steps: Array<{
    sequence: number;
    carrier_ref: string;
    operation_key: string;
    operation_authority: "domain_affordance" | "canon_required";
    expected_cost: number | null;
  }>;
  deferred_claims: Array<{ claim_key: string; reason: string }>;
  resolved_ambiguities: Array<{ key: string; evidence_refs: string[] }>;
};

type CompositionBody = {
  domain?: unknown;
  question?: unknown;
  organizationKey?: unknown;
  membershipId?: unknown;
  serviceDate?: unknown;
};

const ENVELOPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    literal_request: { type: "string" },
    request_mode: { type: "string", enum: ["open_composition", "targeted_request"] },
    fact_items: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string" },
          value: { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] },
          epistemic_status: { type: "string", enum: ["explicit"] },
          source_evidence: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", enum: ["literal_span"] },
              text: { type: "string" },
            },
            required: ["kind", "text"],
          },
        },
        required: ["key", "value", "epistemic_status", "source_evidence"],
      },
    },
    inferred_items: {
      type: "array",
      maxItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string", enum: ["delegated_composition"] },
          value: { type: "boolean" },
          epistemic_status: { type: "string", enum: ["derived"] },
          basis: { type: "string", enum: ["open_ended_planning_request"] },
        },
        required: ["key", "value", "epistemic_status", "basis"],
      },
    },
    retrieval: {
      type: "object",
      additionalProperties: false,
      properties: {
        search_query: { type: "string" },
        expansions: { type: "array", maxItems: 10, uniqueItems: true, items: { type: "string" } },
        city: { anyOf: [{ type: "string" }, { type: "null" }] },
        date_start: { anyOf: [{ type: "string" }, { type: "null" }] },
        date_end: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["search_query", "expansions", "city", "date_start", "date_end"],
    },
  },
  required: ["literal_request", "request_mode", "fact_items", "inferred_items", "retrieval"],
} as const;

const PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    proposal_version: { type: "string", enum: ["composition_proposal_v1"] },
    not_unique_moral_route: { type: "boolean" },
    ordering_authority: { type: "string", enum: ["neutral_composition_policy", "constraint_order", "not_applicable"] },
    neutral_policy_key: { anyOf: [{ type: "string" }, { type: "null" }] },
    not_unique_canon_order: { type: "boolean" },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: MAX_PROPOSAL_CARRIERS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sequence: { type: "integer" },
          carrier_ref: { type: "string" },
          operation_key: { type: "string" },
          operation_authority: { type: "string", enum: ["domain_affordance", "canon_required"] },
          expected_cost: { anyOf: [{ type: "number" }, { type: "null" }] },
        },
        required: ["sequence", "carrier_ref", "operation_key", "operation_authority", "expected_cost"],
      },
    },
    deferred_claims: {
      type: "array",
      maxItems: MAX_PROPOSAL_CARRIERS,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { claim_key: { type: "string" }, reason: { type: "string" } },
        required: ["claim_key", "reason"],
      },
    },
    resolved_ambiguities: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string" },
          evidence_refs: { type: "array", maxItems: 12, items: { type: "string" } },
        },
        required: ["key", "evidence_refs"],
      },
    },
  },
  required: [
    "proposal_version",
    "not_unique_moral_route",
    "ordering_authority",
    "neutral_policy_key",
    "not_unique_canon_order",
    "steps",
    "deferred_claims",
    "resolved_ambiguities",
  ],
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function safeString(value: unknown, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validDate(value: unknown) {
  const text = safeString(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function requestKey(request: Request) {
  return (request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "anonymous")
    .split(",")[0]
    .trim()
    .slice(0, 100);
}

function withinRateLimit(request: Request) {
  const now = Date.now();
  const key = requestKey(request);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (existing.count >= 4) return false;
  existing.count += 1;
  return true;
}

function gatewayToken(request: Request) {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (apiKey) return { token: apiKey, source: "api_key" as const };
  const oidc = request.headers.get("x-vercel-oidc-token") || process.env.VERCEL_OIDC_TOKEN;
  return oidc ? { token: oidc, source: "oidc" as const } : null;
}

async function callGatewayStructured<T>(
  request: Request,
  name: string,
  schema: unknown,
  system: string,
  user: string,
): Promise<T> {
  const auth = gatewayToken(request);
  if (!auth) throw new Error("AI Gateway authentication is unavailable on this request.");
  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      stream: false,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`AI Gateway request failed (${response.status}, ${auth.source}): ${detail}`);
  }
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error(`AI Gateway returned no structured content (${auth.source}).`);
  return JSON.parse(content) as T;
}

function createServerSupabase() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is unavailable.");
  const { url } = getAtlasSupabaseConfig();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function compactCarriers(signals: Record<string, unknown>) {
  const available = Array.isArray(signals.available_carriers) ? signals.available_carriers : [];
  return available
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .filter((item) => item.evidence_state === "resolved")
    .slice(0, MAX_PROPOSAL_CARRIERS)
    .map((item) => ({
      carrier_ref: item.carrier_ref,
      operation_hints: item.operation_hints,
      expected_active_minutes: item.expected_active_minutes ?? null,
      physical_load: item.physical_load ?? null,
      timing_hint: item.timing_hint ?? null,
      source_order_hint: item.source_order_hint ?? null,
      expected_cost: item.expected_cost ?? null,
      current_attributes: item.current_attributes ?? [],
      current_availability: item.current_availability ?? null,
      evidence_refs: item.evidence_refs ?? item.evidence ?? null,
    }));
}

async function generateProposal(
  request: Request,
  domain: string,
  derivedPacket: Record<string, unknown>,
  signals: Record<string, unknown>,
) {
  const carriers = compactCarriers(signals);
  if (!carriers.length) return null;

  const system = `You are the creative proposal generator inside Atlas Shared Composition Engine shadow mode.\n\nYou do NOT decide morality, canon, responsibility, or factual truth. Noel has already supplied the derived packet. The domain adapter has supplied evidence-backed carriers. Your job is only to compose one practical sequence that fits the packet.\n\nHard rules:\n- Use only carrier_ref values in the supplied carrier list.\n- Use only operation_key values actually supported by that carrier's operation_hints unless the derived packet explicitly lists the operation as canon-required.\n- Never invent availability, shade, bathrooms, prices, timing, capacity, readiness, or other affordances.\n- Preserve every protected claim, or put it in deferred_claims with a truthful reason supported by the packet.\n- If Noel preserved an ordering tie, you may choose one practical ordering only under ordering_authority=neutral_composition_policy, neutral_policy_key=shared_tie_set_coherence_v1, and not_unique_canon_order=true.\n- A bounded-discretion route must set not_unique_moral_route=true.\n- Do not narrate. Return only the structured proposal.`;

  return callGatewayStructured<ProposalOutput>(
    request,
    "atlas_composition_proposal_v1",
    PROPOSAL_SCHEMA,
    system,
    JSON.stringify({ domain, derived_packet: derivedPacket, carriers, ambiguities: signals.ambiguities ?? [] }),
  );
}

async function handleLocal(request: Request, body: CompositionBody) {
  const question = safeString(body.question, MAX_QUESTION_LENGTH);
  if (!question) return json({ ok: false, error: "question is required" }, 400);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const interpreterSystem = `You are the request-envelope interpreter for Elm Local's Shared Composition Engine shadow runtime.\n\nYour job is epistemic parsing and broad candidate retrieval only. You do not decide what the person's life is for, which activity is morally better, or what hidden emotional state they have.\n\nLiteral-request rules:\n- Copy literal_request exactly.\n- fact_items may contain only facts explicitly stated in the user's words. Each source_evidence.text must be an exact substring of the literal request.\n- Do not infer exhausted, bored, distressed, overwhelmed, incapable, bad parenting, child misbehavior, a need for education/outdoors/entertainment/rejoicing, a canon function, or a moral priority.\n- If the user asks an open-ended planning question (for example, “what should we do?”, “plan my afternoon”, or “give me a way to spend this time”), set request_mode=open_composition and include delegated_composition=true with basis=open_ended_planning_request. This grants planning authority only; it is not a psychological diagnosis.\n- Otherwise use targeted_request and omit delegated_composition.\n\nRetrieval rules:\n- search_query and expansions are recall aids only. They do not rank or morally authorize candidates.\n- Expansions may include concrete place/activity/service nouns that could broaden discovery, but not value judgments such as “better,” “godly,” “educational first,” or “outdoors first.”\n- Only set city if the user explicitly names it.\n- Resolve explicit relative dates against local date ${today}, America/Chicago, into YYYY-MM-DD. Otherwise date_start/date_end are null.\n- Do not invent local facts.`;

  const interpreted = await callGatewayStructured<EnvelopeOutput>(
    request,
    "elm_composition_request_envelope_v1",
    ENVELOPE_SCHEMA,
    interpreterSystem,
    question,
  );
  interpreted.literal_request = question;

  const organizationKey = safeString(body.organizationKey, 100) || ORGANIZATION_KEY;
  const supabase = createServerSupabase();
  const { data: context, error: contextError } = await supabase.rpc("composition_shadow_local_context_v1", {
    p_organization_key: organizationKey,
    p_lens_key: LOCAL_LENS_KEY,
    p_request_envelope: {
      literal_request: interpreted.literal_request,
      request_mode: interpreted.request_mode,
      fact_items: interpreted.fact_items,
      inferred_items: interpreted.inferred_items,
    },
    p_query: interpreted.retrieval.search_query,
    p_retrieval_expansions: interpreted.retrieval.expansions,
    p_city: interpreted.retrieval.city,
    p_date_start: validDate(interpreted.retrieval.date_start),
    p_date_end: validDate(interpreted.retrieval.date_end),
  });
  if (contextError) throw new Error(`Local shadow context failed: ${contextError.message}`);

  const record = (context ?? {}) as Record<string, unknown>;
  if (record.ok === false) {
    return json({ ok: true, shadow: true, domain: "elm_local", stage: "request_envelope_rejected", context: record });
  }
  const derivation = (record.derivation ?? {}) as Record<string, unknown>;
  const signals = (record.signals ?? {}) as Record<string, unknown>;
  const derivedPacket = (derivation.derived_packet ?? {}) as Record<string, unknown>;
  const proposal = await generateProposal(request, "elm_local", derivedPacket, signals);

  let proposalValidation: unknown = null;
  if (proposal) {
    const derivationId = safeString(derivation.derivation_id, 100);
    const { data, error } = await supabase.rpc("composition_shadow_submit_proposal_v1", {
      p_derivation_id: derivationId,
      p_proposal_key: `gateway:${Date.now()}`,
      p_generator_kind: "vercel_ai_gateway",
      p_generator_version: MODEL,
      p_proposal: proposal,
    });
    if (error) throw new Error(`Local proposal firewall failed: ${error.message}`);
    proposalValidation = data;
  }

  return json({
    ok: true,
    shadow: true,
    domain: "elm_local",
    requestEnvelope: interpreted,
    context: {
      recommendationShadowRunId: record.recommendation_shadow_run_id ?? null,
      derivationId: derivation.derivation_id ?? null,
      derivationState: derivation.derivation_state ?? null,
      derivedPacket,
      candidateEvidence: signals.candidate_evidence ?? null,
      ambiguities: signals.ambiguities ?? [],
    },
    proposal,
    proposalValidation,
    productionEffect: "none",
  });
}

async function handleWorker(request: Request, body: CompositionBody) {
  const membershipId = safeString(body.membershipId, 100);
  const serviceDate = validDate(body.serviceDate);
  if (!/^[0-9a-f-]{36}$/i.test(membershipId) || !serviceDate) {
    return json({ ok: false, error: "valid membershipId and serviceDate are required" }, 400);
  }
  const organizationKey = safeString(body.organizationKey, 100) || ORGANIZATION_KEY;
  const supabase = createServerSupabase();
  const { data: context, error: contextError } = await supabase.rpc("composition_shadow_worker_context_v1", {
    p_organization_key: organizationKey,
    p_membership_id: membershipId,
    p_service_date: serviceDate,
  });
  if (contextError) throw new Error(`Worker shadow context failed: ${contextError.message}`);

  const record = (context ?? {}) as Record<string, unknown>;
  const derivation = (record.derivation ?? {}) as Record<string, unknown>;
  const signals = (record.signals ?? {}) as Record<string, unknown>;
  const derivedPacket = (derivation.derived_packet ?? {}) as Record<string, unknown>;
  const proposal = await generateProposal(request, "atlas_worker_day", derivedPacket, signals);
  if (!proposal) {
    return json({ ok: true, shadow: true, domain: "atlas_worker_day", context: record, proposal: null, productionEffect: "none" });
  }

  const derivationId = safeString(derivation.derivation_id, 100);
  const { data: proposalValidation, error: proposalError } = await supabase.rpc("composition_shadow_submit_proposal_v1", {
    p_derivation_id: derivationId,
    p_proposal_key: `gateway:${Date.now()}`,
    p_generator_kind: "vercel_ai_gateway",
    p_generator_version: MODEL,
    p_proposal: proposal,
  });
  if (proposalError) throw new Error(`Worker proposal firewall failed: ${proposalError.message}`);

  return json({
    ok: true,
    shadow: true,
    domain: "atlas_worker_day",
    context: {
      derivationId: derivation.derivation_id ?? null,
      derivationState: derivation.derivation_state ?? null,
      derivedPacket,
      capacitySummary: signals.capacity_summary ?? null,
      ambiguities: signals.ambiguities ?? [],
    },
    proposal,
    proposalValidation,
    productionEffect: "none",
  });
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV === "production") return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return json({ ok: false, error: "Origin not allowed." }, 403);
  if (!withinRateLimit(request)) return json({ ok: false, error: "Too many shadow requests." }, 429);

  const body = await request.json().catch(() => null) as CompositionBody | null;
  const domain = safeString(body?.domain, 40);
  if (!body || !["elm_local", "atlas_worker_day"].includes(domain)) {
    return json({ ok: false, error: "domain must be elm_local or atlas_worker_day" }, 400);
  }

  try {
    return domain === "elm_local" ? await handleLocal(request, body) : await handleWorker(request, body);
  } catch (error) {
    console.error("Shared Composition Engine shadow runtime failed", error);
    return json({ ok: false, shadow: true, error: error instanceof Error ? error.message : "Shadow runtime failed." }, 500);
  }
}
