import "server-only";

import {
  buildEmployeeWorkJournalDay,
  type EmployeeWorkJournalDay,
  type EmployeeWorkJournalInstitution,
} from "@/lib/employee-work-journal";
import { createAtlasAdminClient } from "@/lib/supabase/admin";
import type { WorkerDelivery } from "@/lib/worker-delivery";
import type { WorkerSessionContext } from "@/lib/worker-session";

export type EmployeeWorkJournalInstitutionRef = {
  organizationId: string;
  organizationName?: string;
  organizationUnitId?: string;
  operatingUnitName?: string;
  employeeSeatId?: string;
  positionId?: string;
  positionTitle?: string;
};

type DeliveryAdapterRow = {
  organization_id: string;
  organization_unit_id: string | null;
  name: string;
};

export async function resolveEmployeeWorkJournalInstitution(
  ref: EmployeeWorkJournalInstitutionRef,
): Promise<EmployeeWorkJournalInstitution> {
  if (!ref.organizationId) {
    throw new Error("Employee Work Journal requires a governing organization identity.");
  }

  // The journal is a presentation contract, not a new authority seam. Do not
  // reach around institutional table grants merely to decorate the page. The
  // current Worker Day adapter may disclose its own operating-unit label from
  // the already-authorized legacy delivery carrier; future delivery adapters
  // can provide their own display metadata directly.
  let operatingUnitName = ref.operatingUnitName;

  if (!operatingUnitName && ref.organizationUnitId) {
    const supabase = createAtlasAdminClient();
    const { data, error } = await supabase
      .from("farms")
      .select("organization_id,organization_unit_id,name")
      .eq("organization_id", ref.organizationId)
      .eq("organization_unit_id", ref.organizationUnitId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Could not resolve Work Journal delivery adapter label: ${error.message}`,
      );
    }

    const adapter = data as DeliveryAdapterRow | null;
    operatingUnitName = adapter?.name ?? undefined;
  }

  return {
    organizationId: ref.organizationId,
    organizationName: ref.organizationName,
    operatingUnitId: ref.organizationUnitId,
    operatingUnitName,
    employeeSeatId: ref.employeeSeatId,
    positionId: ref.positionId,
    positionTitle: ref.positionTitle,
  };
}

export async function buildEmployeeWorkJournalFromDelivery(
  delivery: WorkerDelivery,
  workerContext?: WorkerSessionContext | null,
): Promise<EmployeeWorkJournalDay> {
  const institution = await resolveEmployeeWorkJournalInstitution({
    organizationId: delivery.institutionRef.organizationId,
    organizationUnitId:
      workerContext?.organizationUnitId ?? delivery.institutionRef.organizationUnitId,
    employeeSeatId: workerContext?.employeeSeatId,
    positionId: workerContext?.positionId,
    positionTitle: workerContext?.positionTitle,
  });

  return buildEmployeeWorkJournalDay({
    date: delivery.date,
    timeZone: delivery.timeZone,
    institution,
    items: delivery.items,
    reported: delivery.extras,
  });
}
