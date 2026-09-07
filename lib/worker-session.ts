import "server-only";

import { cookies } from "next/headers";

import { createAtlasAdminClient } from "@/lib/supabase/admin";
import {
  ELM_WORK_SESSION_COOKIE,
  hashWorkerCredential,
} from "@/lib/worker-work-pass";

export const WORKER_DAY_PILOT_SCOPE = "anna_worker_day_pilot";

export type WorkerSessionContext = {
  organizationMembershipId: string;
  deliveryMembershipId: string;
  organizationId: string;
  institutionalPersonId?: string;
  scope: string;
  expiresAt: string;
};

type WorkerSessionStatus = {
  ok?: boolean;
  sessionId?: string;
  membershipId?: string;
  organizationMembershipId?: string;
  expiresAt?: string;
  code?: string;
};

type OrganizationMembershipRow = {
  organization_id: string;
};

export async function getWorkerSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(ELM_WORK_SESSION_COOKIE)?.value ?? null;
}

export async function resolveWorkerSessionContext(
  rawSessionToken: string,
): Promise<WorkerSessionContext | null> {
  const sessionToken = rawSessionToken.trim();
  if (!sessionToken) {
    return null;
  }

  const supabase = createAtlasAdminClient();
  const { data, error } = await supabase.rpc(
    "worker_delivery_pilot_session_status_v1",
    {
      p_session_token_hash: hashWorkerCredential(sessionToken),
    },
  );

  if (error) {
    console.error("Worker session status read failed:", error);
    return null;
  }

  const status = (data ?? {}) as WorkerSessionStatus;
  if (
    status.ok !== true ||
    !status.membershipId ||
    !status.organizationMembershipId ||
    !status.expiresAt
  ) {
    return null;
  }

  const { data: organizationMembership, error: organizationMembershipError } =
    await supabase
      .from("organization_memberships")
      .select("organization_id")
      .eq("id", status.organizationMembershipId)
      .maybeSingle();

  if (organizationMembershipError) {
    console.error(
      "Worker session organization membership read failed:",
      organizationMembershipError,
    );
    return null;
  }

  const organizationRow = organizationMembership as OrganizationMembershipRow | null;
  if (!organizationRow?.organization_id) {
    return null;
  }

  return {
    organizationMembershipId: status.organizationMembershipId,
    deliveryMembershipId: status.membershipId,
    organizationId: organizationRow.organization_id,
    scope: WORKER_DAY_PILOT_SCOPE,
    expiresAt: status.expiresAt,
  };
}

export async function getCurrentWorkerSessionContext() {
  const sessionToken = await getWorkerSessionToken();
  if (!sessionToken) {
    return null;
  }

  return resolveWorkerSessionContext(sessionToken);
}
