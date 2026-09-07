import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { createAtlasAdminClient } from "@/lib/supabase/admin";
import { ANNA_FARM_MEMBERSHIP_ID } from "@/lib/worker-delivery";

export const ELM_WORK_SESSION_COOKIE = "elm_work_session";

const ANNA_ELM_ORGANIZATION_MEMBERSHIP_ID =
  "4bda9631-07a6-43ae-9f51-4cb63d78c803";

type RedeemResult = {
  ok?: boolean;
  membershipId?: string;
  organizationMembershipId?: string;
  expiresAt?: string;
  code?: string;
};

type WorkSurface = {
  organizationMembershipId: string;
  destination: string;
};

const WORK_SURFACES: Record<string, WorkSurface> = {
  [ANNA_FARM_MEMBERSHIP_ID]: {
    organizationMembershipId: ANNA_ELM_ORGANIZATION_MEMBERSHIP_ID,
    destination: "/anna",
  },
};

export function hashWorkerCredential(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function redeemElmWorkPass(rawBootstrapToken: string) {
  const bootstrapToken = rawBootstrapToken.trim();
  if (!bootstrapToken) {
    return null;
  }

  const sessionToken = randomBytes(32).toString("base64url");
  const supabase = createAtlasAdminClient();
  const { data, error } = await supabase.rpc(
    "redeem_worker_delivery_pilot_capability_v1",
    {
      p_bootstrap_token_hash: hashWorkerCredential(bootstrapToken),
      p_session_token_hash: hashWorkerCredential(sessionToken),
    },
  );

  if (error) {
    console.error("Elm Work Pass redemption failed:", error);
    return null;
  }

  const result = (data ?? {}) as RedeemResult;
  if (
    result.ok !== true ||
    !result.membershipId ||
    !result.organizationMembershipId ||
    !result.expiresAt
  ) {
    return null;
  }

  const surface = WORK_SURFACES[result.membershipId];
  if (
    !surface ||
    surface.organizationMembershipId !== result.organizationMembershipId
  ) {
    console.error("Elm Work Pass identity binding did not map to a work surface.");
    return null;
  }

  const expiresAt = new Date(result.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return {
    sessionToken,
    expiresAt,
    destination: surface.destination,
  };
}
