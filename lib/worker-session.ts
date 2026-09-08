import "server-only";

import { cookies } from "next/headers";

import { createAtlasAdminClient } from "@/lib/supabase/admin";
import { createAtlasServerClient } from "@/lib/supabase/server";
import {
  ELM_WORK_SESSION_COOKIE,
  hashWorkerCredential,
} from "@/lib/worker-work-pass";

export const WORKER_DAY_PILOT_SCOPE = "anna_worker_day_pilot";
export const EMPLOYEE_SEAT_SCOPE = "organization_employee_seat";

export type WorkerSessionContext = {
  organizationMembershipId: string;
  deliveryMembershipId: string;
  organizationId: string;
  institutionalPersonId?: string;
  employeeSeatId?: string;
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

type EmployeeSeatContextStatus = {
  ok?: boolean;
  organizationId?: string;
  organizationMembershipId?: string;
  identitySubjectId?: string;
  employeeSeatId?: string;
  credentialId?: string;
  code?: string;
};

type OrganizationMembershipRow = {
  organization_id: string;
};

type FarmMembershipRow = {
  id: string;
  farm_id: string;
};

type FarmRow = {
  id: string;
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
      .select("organization_id,identity_subject_id")
      .eq("id", status.organizationMembershipId)
      .maybeSingle();

  if (organizationMembershipError) {
    console.error(
      "Worker session organization membership read failed:",
      organizationMembershipError,
    );
    return null;
  }

  const organizationRow = organizationMembership as
    | (OrganizationMembershipRow & { identity_subject_id?: string | null })
    | null;
  if (!organizationRow?.organization_id) {
    return null;
  }

  return {
    organizationMembershipId: status.organizationMembershipId,
    deliveryMembershipId: status.membershipId,
    organizationId: organizationRow.organization_id,
    institutionalPersonId: organizationRow.identity_subject_id ?? undefined,
    scope: WORKER_DAY_PILOT_SCOPE,
    expiresAt: status.expiresAt,
  };
}

async function resolveAuthenticatedEmployeeSeatContext(): Promise<WorkerSessionContext | null> {
  const authClient = await createAtlasServerClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const {
    data: { session },
  } = await authClient.auth.getSession();
  if (!session?.expires_at) {
    return null;
  }

  const supabase = createAtlasAdminClient();
  const { data: seatContext, error: seatContextError } = await supabase.rpc(
    "organization_employee_context_by_auth_user_v1",
    {
      p_auth_user_id: user.id,
      p_organization_id: null,
    },
  );

  if (seatContextError) {
    console.error("Employee seat context read failed:", seatContextError);
    return null;
  }

  const status = (seatContext ?? {}) as EmployeeSeatContextStatus;
  if (
    status.ok !== true ||
    !status.organizationId ||
    !status.organizationMembershipId ||
    !status.identitySubjectId ||
    !status.employeeSeatId
  ) {
    return null;
  }

  const { data: farmMemberships, error: farmMembershipError } = await supabase
    .from("farm_memberships")
    .select("id,farm_id")
    .eq("identity_subject_id", status.identitySubjectId)
    .eq("active", true);

  if (farmMembershipError) {
    console.error("Employee operating membership read failed:", farmMembershipError);
    return null;
  }

  const membershipRows = (farmMemberships ?? []) as FarmMembershipRow[];
  if (membershipRows.length === 0) {
    return null;
  }

  const { data: farms, error: farmError } = await supabase
    .from("farms")
    .select("id,organization_id")
    .in(
      "id",
      membershipRows.map((membership) => membership.farm_id),
    )
    .eq("organization_id", status.organizationId);

  if (farmError) {
    console.error("Employee operating-unit organization read failed:", farmError);
    return null;
  }

  const organizationFarmIds = new Set(
    ((farms ?? []) as FarmRow[]).map((farm) => farm.id),
  );
  const deliveryMemberships = membershipRows.filter((membership) =>
    organizationFarmIds.has(membership.farm_id),
  );

  // Worker Day currently delivers through one operating-unit membership.
  // Do not choose arbitrarily if an employee later belongs to multiple units;
  // the generic /today projection will need to aggregate those memberships.
  if (deliveryMemberships.length !== 1) {
    if (deliveryMemberships.length > 1) {
      console.error(
        "Employee seat has multiple active operating memberships; Worker Day refuses to guess.",
      );
    }
    return null;
  }

  return {
    organizationMembershipId: status.organizationMembershipId,
    deliveryMembershipId: deliveryMemberships[0].id,
    organizationId: status.organizationId,
    institutionalPersonId: status.identitySubjectId,
    employeeSeatId: status.employeeSeatId,
    scope: EMPLOYEE_SEAT_SCOPE,
    expiresAt: new Date(session.expires_at * 1000).toISOString(),
  };
}

export async function getCurrentWorkerSessionContext() {
  const employeeSeatContext = await resolveAuthenticatedEmployeeSeatContext();
  if (employeeSeatContext) {
    return employeeSeatContext;
  }

  const sessionToken = await getWorkerSessionToken();
  if (!sessionToken) {
    return null;
  }

  return resolveWorkerSessionContext(sessionToken);
}
