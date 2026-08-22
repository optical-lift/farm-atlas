import { createAtlasServerClient } from "@/lib/supabase/server";

export type EntityIdentityReviewKind = "ingestion_candidate_match" | "entity_merge";

export type EntityIdentityReviewItem = {
  review_kind: EntityIdentityReviewKind;
  review_id: string;
  review_state: string;
  subject_label: string;
  recommended_target_label: string;
  recommended_target_entity_id: string;
  recommended_relationship: string;
  algorithm_key: string | null;
  algorithm_version: string | null;
  recommendation_basis: string | null;
  evidence: Record<string, unknown> | null;
  adjudication_state: string | null;
  adjudicated_by: string | null;
  adjudicated_at: string | null;
  hard_rules_required: number;
  hard_rules_evaluated: number;
  hard_veto_failures: number;
  hard_unknowns: number;
  approval_ready: boolean;
  eligible_for_auto_merge: boolean;
  canonical_merge_executed: boolean;
  recommended_at: string | null;
};

export type EntityIdentityReviewPacket = {
  contractVersion: "entity_identity_review_v1";
  state: "clear" | "review_required";
  pendingCount: number;
  reviewerUserId: string;
  principalId: string;
  items: EntityIdentityReviewItem[];
  truthBoundary: {
    humanAdjudicationRequired: boolean;
    rawMutationExposed: boolean;
    approvalIsCanonicalMergeExecution: boolean;
    canonicalMergeExecutionAvailableHere: boolean;
  };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function readAtlasEntityIdentityReviewQueue(): Promise<EntityIdentityReviewPacket> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("entity_identity_review_queue_api_v1");

  if (error) throw new Error("Atlas could not read the identity review queue.");
  if (!isObject(data) || data.contractVersion !== "entity_identity_review_v1" || !Array.isArray(data.items)) {
    throw new Error("Atlas received an invalid identity review contract.");
  }

  return data as unknown as EntityIdentityReviewPacket;
}
