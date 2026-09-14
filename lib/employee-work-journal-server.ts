import "server-only";

import type { EmployeeWorkJournalInstitution } from "@/lib/employee-work-journal";
import { createAtlasAdminClient } from "@/lib/supabase/admin";

export type EmployeeWorkJournalInstitutionRef = {
  organizationId: string;
  organizationUnitId?: string;
  employeeSeatId?: string;
  positionId?: string;
  positionTitle?: string;
};

type OrganizationRow = {
  id: string;
  name: string;
};

type OrganizationUnitRow = {
  id: string;
  name: string;
};

type OrganizationPositionRow = {
  id: string;
  display_title: string;
};

export async function resolveEmployeeWorkJournalInstitution(
  ref: EmployeeWorkJournalInstitutionRef,
): Promise<EmployeeWorkJournalInstitution> {
  const supabase = createAtlasAdminClient();

  const organizationPromise = supabase
    .from("organizations")
    .select("id,name")
    .eq("id", ref.organizationId)
    .maybeSingle();

  const unitPromise = ref.organizationUnitId
    ? supabase
        .from("organization_units")
        .select("id,name")
        .eq("id", ref.organizationUnitId)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const positionPromise = ref.positionId
    ? supabase
        .from("organization_positions")
        .select("id,display_title")
        .eq("id", ref.positionId)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [organizationResult, unitResult, positionResult] = await Promise.all([
    organizationPromise,
    unitPromise,
    positionPromise,
  ]);

  if (organizationResult.error) {
    throw new Error(
      `Could not resolve Work Journal organization: ${organizationResult.error.message}`,
    );
  }

  const organization = organizationResult.data as OrganizationRow | null;
  if (!organization?.id || !organization.name) {
    throw new Error("Employee Work Journal requires a real organization identity.");
  }

  if (unitResult.error) {
    throw new Error(
      `Could not resolve Work Journal operating unit: ${unitResult.error.message}`,
    );
  }

  if (positionResult.error) {
    throw new Error(
      `Could not resolve Work Journal position: ${positionResult.error.message}`,
    );
  }

  const unit = unitResult.data as OrganizationUnitRow | null;
  const position = positionResult.data as OrganizationPositionRow | null;

  return {
    organizationId: organization.id,
    organizationName: organization.name,
    operatingUnitId: unit?.id ?? ref.organizationUnitId,
    operatingUnitName: unit?.name,
    employeeSeatId: ref.employeeSeatId,
    positionId: position?.id ?? ref.positionId,
    positionTitle: position?.display_title ?? ref.positionTitle,
  };
}
