import { NextResponse } from "next/server";

import { atlasApiError, readAtlasJsonBody } from "@/lib/atlas/api-access";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type AuthoringKind = "owner_obligation" | "portfolio_thesis";
type RpcError = { code?: string; message?: string };

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
  if ((kind !== "owner_obligation" && kind !== "portfolio_thesis") || !input || typeof input !== "object" || Array.isArray(input)) {
    return atlasApiError(400, "invalid_authoring_input", "A supported Principal authoring kind and input object are required.");
  }

  try {
    const supabase = await createAtlasServerClient();
    const normalizedInput = kind === "owner_obligation"
      ? ownerObligationInput(input as Record<string, unknown>)
      : portfolioThesisInput(input as Record<string, unknown>);
    const rpc = kind === "owner_obligation"
      ? "principal_upsert_owner_obligation_api_v1"
      : "principal_upsert_portfolio_thesis_api_v1";

    const { data, error } = await supabase.rpc(rpc, { p_input: normalizedInput });
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
