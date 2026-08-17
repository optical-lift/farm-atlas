import { NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody } from "@/lib/atlas/api-access";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AuthoringKind =
  | "owner_obligation"
  | "portfolio_thesis"
  | "attention_policy"
  | "operating_function"
  | "great_game_scorecard"
  | "capital_request"
  | "investment_opportunity";

type RpcError = { code?: string; message?: string };

type AuthoringRoute = {
  rpc: string;
  normalize: (input: Record<string, unknown>) => Record<string, unknown>;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Write-Path": "principal-authoring-v1",
    },
  });
}

function nonBlank(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "principal-record";
}

async function requirePrincipalOwner() {
  const session = await getAtlasSession();
  if (!session) {
    return { ok: false as const, response: atlasApiError(401, "sign_in_required", "Sign in required.") };
  }

  const ownerMembership = session.organizationMemberships.find((membership) => membership.role === "owner");
  if (!ownerMembership) {
    return {
      ok: false as const,
      response: atlasApiError(403, "principal_owner_required", "Principal owner access is required."),
    };
  }

  return { ok: true as const, session, ownerMembership };
}

function ownerObligationInput(input: Record<string, unknown>) {
  const title = nonBlank(input.title);
  const domain = nonBlank(input.domain);
  const expectedMinutes = positiveInteger(input.expectedMinutes);
  const protectionLevel = nonBlank(input.protectionLevel);
  const floorClass = positiveInteger(input.floorClass);
  const ownerCapability = nonBlank(input.ownerCapability);
  const consequenceOfDelay = nonBlank(input.consequenceOfDelay);
  const reasonForFloor = nonBlank(input.reasonForFloor);

  if (
    !title || !domain || !expectedMinutes || !protectionLevel || !floorClass || floorClass > 7 ||
    !ownerCapability || !consequenceOfDelay || !reasonForFloor
  ) {
    throw new Error("Complete the required Owner Obligation fields before saving.");
  }

  const portfolioUnitStableKey = nonBlank(input.portfolioUnitStableKey);
  const stableKey = nonBlank(input.stableKey)
    ?? slug(`${domain}-${portfolioUnitStableKey ?? "principal"}-${title}`);

  return {
    stableKey,
    domain,
    portfolioUnitStableKey,
    title,
    description: nonBlank(input.description),
    horizon: nonBlank(input.horizon),
    becomesRelevantAt: nonBlank(input.becomesRelevantAt),
    mustBeginBy: nonBlank(input.mustBeginBy),
    mustFinishBy: nonBlank(input.mustFinishBy),
    expectedMinutes,
    protectionLevel,
    floorClass,
    ownerCapability,
    interruptibility: nonBlank(input.interruptibility) ?? "low_interruptibility",
    delegable: false,
    ownerRequired: true,
    consequenceOfDelay,
    reasonForFloor,
    status: nonBlank(input.status) ?? "open",
    source: "principal_ui_v1",
    metadata: { authoredFrom: "/principal/author" },
  };
}

function portfolioThesisInput(input: Record<string, unknown>) {
  const portfolioUnitStableKey = nonBlank(input.portfolioUnitStableKey);
  const thesisStatement = nonBlank(input.thesisStatement);

  if (!portfolioUnitStableKey || !thesisStatement) {
    throw new Error("Choose a portfolio unit and write the thesis statement before saving.");
  }

  const reviewCadenceDays = input.reviewCadenceDays === null || input.reviewCadenceDays === undefined || input.reviewCadenceDays === ""
    ? null
    : positiveInteger(input.reviewCadenceDays);

  if (input.reviewCadenceDays && !reviewCadenceDays) {
    throw new Error("Review cadence must be a positive number of days.");
  }

  return {
    portfolioUnitStableKey,
    stableKey: nonBlank(input.stableKey) ?? "current",
    thesisStatement,
    valueCreationLogic: nonBlank(input.valueCreationLogic),
    mustBecomeTrue: Array.isArray(input.mustBecomeTrue) ? input.mustBecomeTrue : [],
    capitalRequired: input.capitalRequired && typeof input.capitalRequired === "object" && !Array.isArray(input.capitalRequired)
      ? input.capitalRequired
      : {},
    nextValueMilestone: nonBlank(input.nextValueMilestone),
    assumptions: Array.isArray(input.assumptions) ? input.assumptions : [],
    reconsiderationConditions: Array.isArray(input.reconsiderationConditions) ? input.reconsiderationConditions : [],
    reviewCadenceDays,
    nextReviewAt: nonBlank(input.nextReviewAt),
    status: nonBlank(input.status) ?? "draft",
    source: "principal_ui_v1",
    metadata: { authoredFrom: "/principal/author" },
  };
}

function attentionPolicyInput(input: Record<string, unknown>) {
  const subjectTitle = nonBlank(input.subjectTitle);
  const subjectType = nonBlank(input.subjectType);
  const portfolioUnitStableKey = nonBlank(input.portfolioUnitStableKey);
  const cadenceDays = positiveInteger(input.cadenceDays);
  const firstDueAt = nonBlank(input.firstDueAt);
  const protectedOwnerMinutes = positiveInteger(input.protectedOwnerMinutes);
  const floorClass = positiveInteger(input.floorClass);
  const protectionLevel = nonBlank(input.protectionLevel);
  const consequence = nonBlank(input.consequence);
  const reasonForFloor = nonBlank(input.reasonForFloor);

  if (
    !subjectTitle || !subjectType || !cadenceDays || !firstDueAt || !protectedOwnerMinutes ||
    !floorClass || floorClass > 7 || !protectionLevel || !consequence || !reasonForFloor
  ) {
    throw new Error("Complete the required Attention Policy fields before saving.");
  }
  if (subjectType === "portfolio_unit" && !portfolioUnitStableKey) {
    throw new Error("Choose the portfolio unit this attention policy protects.");
  }

  const subjectStableKey = nonBlank(input.subjectStableKey)
    ?? slug(`${subjectType}-${portfolioUnitStableKey ?? subjectTitle}`);

  return {
    subjectStableKey,
    subjectTitle,
    subjectType,
    portfolioUnitStableKey,
    policyStableKey: nonBlank(input.policyStableKey) ?? "cadence",
    cadenceDays,
    firstDueAt,
    protectedOwnerMinutes,
    floorClass,
    protectionLevel,
    interruptibility: nonBlank(input.interruptibility) ?? "low_interruptibility",
    consequence,
    reasonForFloor,
    source: "principal_ui_v1",
    subjectMetadata: { authoredFrom: "/principal/author/office" },
    policyMetadata: { authoredFrom: "/principal/author/office" },
  };
}

function operatingFunctionInput(input: Record<string, unknown>) {
  const name = nonBlank(input.name);
  const charter = nonBlank(input.charter);
  if (!name || !charter) {
    throw new Error("Name and charter are required for a durable operating function.");
  }

  const reviewCadenceDays = input.reviewCadenceDays === null || input.reviewCadenceDays === undefined || input.reviewCadenceDays === ""
    ? null
    : positiveInteger(input.reviewCadenceDays);
  if (input.reviewCadenceDays && !reviewCadenceDays) {
    throw new Error("Function review cadence must be a positive number of days.");
  }

  return {
    stableKey: nonBlank(input.stableKey) ?? slug(name),
    name,
    charter,
    portfolioUnitStableKey: nonBlank(input.portfolioUnitStableKey),
    capacityState: nonBlank(input.capacityState),
    reviewCadenceDays,
    active: true,
    source: "principal_ui_v1",
    metadata: { authoredFrom: "/principal/author/office" },
  };
}

function greatGameScorecardInput(input: Record<string, unknown>) {
  const name = nonBlank(input.name);
  const criticalNumber = nonBlank(input.criticalNumber);
  const operatingFunctionStableKey = nonBlank(input.operatingFunctionStableKey);
  const portfolioUnitStableKey = nonBlank(input.portfolioUnitStableKey);
  if (!name || !criticalNumber || (!operatingFunctionStableKey && !portfolioUnitStableKey)) {
    throw new Error("A scorecard needs a name, Critical Number, and a function or portfolio-unit scope.");
  }

  const scope = operatingFunctionStableKey ?? portfolioUnitStableKey ?? "principal";
  return {
    stableKey: nonBlank(input.stableKey) ?? slug(`${scope}-${name}`),
    name,
    criticalNumber,
    drivers: Array.isArray(input.drivers) ? input.drivers : [],
    operatingFunctionStableKey,
    portfolioUnitStableKey,
    active: true,
    source: "principal_ui_v1",
    metadata: { authoredFrom: "/principal/author/office" },
  };
}

function capitalRequestInput(input: Record<string, unknown>) {
  const title = nonBlank(input.title);
  const amount = positiveNumber(input.amount);
  const currency = nonBlank(input.currency);
  const reason = nonBlank(input.reason);
  const portfolioUnitStableKey = nonBlank(input.portfolioUnitStableKey);
  if (!title || !amount || !currency || !reason) {
    throw new Error("Capital requests require a title, positive amount, currency, and reason.");
  }

  return {
    stableKey: nonBlank(input.stableKey) ?? slug(`${portfolioUnitStableKey ?? "principal"}-${title}`),
    title,
    portfolioUnitStableKey,
    amount,
    currency: currency.toUpperCase(),
    neededBy: nonBlank(input.neededBy),
    reason,
    status: "requested",
    source: "principal_ui_v1",
    metadata: { authoredFrom: "/principal/author/office" },
  };
}

function investmentOpportunityInput(input: Record<string, unknown>) {
  const title = nonBlank(input.title);
  const readinessState = nonBlank(input.readinessState);
  const portfolioUnitStableKey = nonBlank(input.portfolioUnitStableKey);
  const capitalRequired = input.capitalRequired === null || input.capitalRequired === undefined || input.capitalRequired === ""
    ? null
    : positiveNumber(input.capitalRequired);
  const currency = nonBlank(input.currency);

  if (!title || !readinessState) {
    throw new Error("Investment opportunities require a title and readiness state.");
  }
  if (input.capitalRequired && !capitalRequired) {
    throw new Error("Capital required must be a positive amount when supplied.");
  }
  if (capitalRequired && !currency) {
    throw new Error("Currency is required when capital required is supplied.");
  }

  return {
    stableKey: nonBlank(input.stableKey) ?? slug(`${portfolioUnitStableKey ?? "principal"}-${title}`),
    title,
    portfolioUnitStableKey,
    capitalRequired,
    currency: currency?.toUpperCase() ?? null,
    readinessState,
    nextValueMilestone: nonBlank(input.nextValueMilestone),
    status: "active",
    source: "principal_ui_v1",
    metadata: { authoredFrom: "/principal/author/office" },
  };
}

const authoringRoutes: Record<AuthoringKind, AuthoringRoute> = {
  owner_obligation: { rpc: "principal_upsert_owner_obligation_api_v1", normalize: ownerObligationInput },
  portfolio_thesis: { rpc: "principal_upsert_portfolio_thesis_api_v1", normalize: portfolioThesisInput },
  attention_policy: { rpc: "principal_upsert_attention_policy_api_v1", normalize: attentionPolicyInput },
  operating_function: { rpc: "principal_upsert_operating_function_api_v1", normalize: operatingFunctionInput },
  great_game_scorecard: { rpc: "principal_upsert_great_game_scorecard_api_v1", normalize: greatGameScorecardInput },
  capital_request: { rpc: "principal_upsert_capital_request_api_v1", normalize: capitalRequestInput },
  investment_opportunity: { rpc: "principal_upsert_investment_opportunity_api_v1", normalize: investmentOpportunityInput },
};

export async function POST(request: Request) {
  const authorized = await requirePrincipalOwner();
  if (!authorized.ok) return authorized.response;

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch (error) {
    return atlasApiError(400, "invalid_request", error instanceof Error ? error.message : "Invalid request.");
  }

  const kind = nonBlank(body.kind) as AuthoringKind | null;
  const input = body.input;
  const route = kind ? authoringRoutes[kind] : null;
  if (!kind || !route || !input || typeof input !== "object" || Array.isArray(input)) {
    return atlasApiError(400, "invalid_authoring_input", "A supported Principal authoring kind and input object are required.");
  }

  try {
    const supabase = await createAtlasServerClient();
    const normalizedInput = route.normalize(input as Record<string, unknown>);
    const { data, error } = await supabase.rpc(route.rpc, { p_input: normalizedInput });
    if (error) throw error;

    return privateJson({ ok: true, kind, result: data });
  } catch (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return atlasApiError(403, "principal_context_required", "An active Principal context is required.");
    }
    if (rpcError.code === "22023" || rpcError.code === "P0002" || error instanceof Error) {
      return atlasApiError(400, "principal_authoring_rejected", error instanceof Error ? error.message : rpcError.message ?? "Principal authoring was rejected.");
    }
    console.error("Atlas Principal authoring failed:", error);
    return atlasApiError(500, "principal_authoring_failed", "Atlas could not save this Principal record.");
  }
}
