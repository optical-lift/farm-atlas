import {
  atlasApiError,
  readAtlasJsonBody,
} from "@/lib/atlas/api-access";
import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RequestBody = {
  reviewKind?: unknown;
  reviewId?: unknown;
  decision?: unknown;
  basis?: unknown;
  metadata?: unknown;
};

type RpcError = { code?: string; message?: string };

function validUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function ownerSession(session: Awaited<ReturnType<typeof getAtlasSession>>) {
  return Boolean(session?.organizationMemberships.some((membership) => membership.role === "owner"));
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "entity-identity-review-v1") {
    return atlasApiError(400, "entity_identity_review_intent_required", "A valid identity review intent is required.");
  }

  const session = await getAtlasSession();
  if (!session) return atlasApiError(401, "sign_in_required", "Sign in required.");
  if (!ownerSession(session)) {
    return atlasApiError(403, "principal_owner_required", "Principal owner access is required for identity adjudication.");
  }

  let body: RequestBody;
  try {
    body = await readAtlasJsonBody(request) as RequestBody;
  } catch {
    return atlasApiError(400, "entity_identity_review_invalid_json", "The identity review request is invalid.");
  }

  if (body.reviewKind !== "ingestion_candidate_match" && body.reviewKind !== "entity_merge") {
    return atlasApiError(400, "entity_identity_review_kind_required", "A valid review kind is required.");
  }
  if (!validUuid(body.reviewId)) {
    return atlasApiError(400, "entity_identity_review_id_required", "A valid review ID is required.");
  }
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return atlasApiError(400, "entity_identity_review_decision_required", "Choose Approve or Reject.");
  }
  if (typeof body.basis !== "string" || !body.basis.trim()) {
    return atlasApiError(400, "entity_identity_review_basis_required", "A reviewer reason is required.");
  }
  if (body.basis.trim().length > 4000) {
    return atlasApiError(400, "entity_identity_review_basis_too_long", "The reviewer reason is too long.");
  }
  if (body.metadata !== undefined && (!body.metadata || typeof body.metadata !== "object" || Array.isArray(body.metadata))) {
    return atlasApiError(400, "entity_identity_review_metadata_invalid", "Review metadata must be an object.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("entity_identity_adjudicate_api_v1", {
    p_input: {
      reviewKind: body.reviewKind,
      reviewId: body.reviewId,
      decision: body.decision,
      basis: body.basis.trim(),
      metadata: body.metadata ?? {},
    },
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return atlasApiError(403, "entity_identity_review_forbidden", rpcError.message || "This account cannot adjudicate identity reviews.");
    }
    if (rpcError.code === "22023") {
      return atlasApiError(409, "entity_identity_review_stale_or_invalid", rpcError.message || "This review item is no longer available for that decision.");
    }
    return atlasApiError(500, "entity_identity_review_failed", "Atlas could not record this identity adjudication.");
  }

  return Response.json({ ok: true, adjudication: data }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
