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
  organizationUnitId?: string;
  positionId?: string;
  positionKey?: string;
  positionTitle?: string;
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

type EmployeeAppointment = {
  credentialId?: string;
  employeeSeatId?: string;
  organizationId?: string;
  organizationMembershipId?: string;
  identitySubjectId?: string;
  appointmentId?: string;
  appointmentKind?: string;
  positionId?: string;
  positionKey?: string;
  displayTitle?: string;
  organizationUnitId?: string;
  organizationUnitKey?: string;
  organizationUnitName?: string;
  organizationUnitKind?: string;
};

type EmployeeAppointmentsStatus = {
  ok?: boolean;
  items?: EmployeeAppointment[];
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
  organization_unit_id: string | null;
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
  const { data: appointmentContext, error: appointmentError } = await supabase.rpc(
    "organization_employee_appointments_by_auth_user_v1",
    {
      p_auth_user_id: user.id,
      p_organization_id: null,
    },
  );

  if (appointmentError) {
    console.error("Employee appointment context read failed:", appointmentError);
    return null;
  }

  const appointmentStatus = (appointmentContext ?? {}) as EmployeeAppointmentsStatus;
  const appointments = Array.isArray(appointmentStatus.items)
    ? appointmentStatus.items
    : [];

  if (appointmentStatus.ok !== true || appointments.length === 0) {
    return null;
  }

  const primaryAppointments = appointments.filter(
    (appointment) => appointment.appointmentKind === "primary",
  );
  const selectedAppointments = primaryAppointments.length > 0
    ? primaryAppointments
    : appointments;

  // Today still delivers one operating-unit lane at a time. Institutional
  // placement is authoritative; never infer a unit from a domain membership.
  if (selectedAppointments.length !== 1) {
    if (selectedAppointments.length > 1) {
      console.error(
        "Employee has multiple active institutional appointments; Worker Day refuses to guess a primary unit.",
      );
    }
    return null;
  }

  const appointment = selectedAppointments[0];
  if (
    !appointment.organizationId ||
    !appointment.organizationMembershipId ||
    !appointment.identitySubjectId ||
    !appointment.employeeSeatId ||
    !appointment.organizationUnitId ||
    !appointment.positionId
  ) {
    return null;
  }

  // Compatibility adapter only: current Worker Day delivery still keys from
  // a farm membership. The appointment chooses the organization unit first,
  // then Atlas finds a domain delivery membership bound to that same unit.
  const { data: farms, error: farmError } = await supabase
    .from("farms")
    .select("id,organization_id,organization_unit_id")
    .eq("organization_id", appointment.organizationId)
    .eq("organization_unit_id", appointment.organizationUnitId);

  if (farmError) {
    console.error("Employee delivery adapter unit read failed:", farmError);
    return null;
  }

  const unitFarmIds = ((farms ?? []) as FarmRow[]).map((farm) => farm.id);
  if (unitFarmIds.length === 0) {
    return null;
  }

  const { data: farmMemberships, error: farmMembershipError } = await supabase
    .from("farm_memberships")
    .select("id,farm_id")
    .eq("identity_subject_id", appointment.identitySubjectId)
    .eq("active", true)
    .in("farm_id", unitFarmIds);

  if (farmMembershipError) {
    console.error("Employee delivery membership read failed:", farmMembershipError);
    return null;
  }

  const deliveryMemberships = (farmMemberships ?? []) as FarmMembershipRow[];
  if (deliveryMemberships.length !== 1) {
    if (deliveryMemberships.length > 1) {
      console.error(
        "Institutional appointment maps to multiple legacy delivery memberships; Worker Day refuses to guess.",
      );
    }
    return null;
  }

  return {
    organizationMembershipId: appointment.organizationMembershipId,
    deliveryMembershipId: deliveryMemberships[0].id,
    organizationId: appointment.organizationId,
    organizationUnitId: appointment.organizationUnitId,
    positionId: appointment.positionId,
    positionKey: appointment.positionKey,
    positionTitle: appointment.displayTitle,
    institutionalPersonId: appointment.identitySubjectId,
    employeeSeatId: appointment.employeeSeatId,
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
