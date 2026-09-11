import { createAtlasServerClient } from "@/lib/supabase/server";

export type CompanyWorkResponsibility = {
  organizationId: string;
  organizationName: string;
  organizationUnitId: string | null;
  organizationUnitKey: string | null;
  organizationUnitName: string | null;
  workItemId: string;
  allocationId: string;
  title: string;
  instructions: string | null;
  workState: string;
  operationClass: string | null;
  allocationRole: string;
  allocatedAt: string;
  requirements: Array<{
    requirementId?: string;
    summary?: string;
    state?: string;
    earliestRelevantAt?: string | null;
    latestSatisfactoryAt?: string | null;
    consequenceOfDelay?: unknown;
  }>;
  nextTargetAt: string | null;
  executionState: "ready" | "waiting" | "needs_resolution" | "unassessed" | string;
  executionReason: string | null;
  legacyTaskId: string | null;
  legacyTaskStatus: string | null;
  legacyTaskDueDate: string | null;
  attentionLeaseId: string | null;
  attentionLeaseState: string | null;
};

type CompanyWorkResponsibilityRow = {
  organization_id: string;
  organization_name: string;
  organization_unit_id: string | null;
  organization_unit_key: string | null;
  organization_unit_name: string | null;
  work_item_id: string;
  allocation_id: string;
  title: string;
  instructions: string | null;
  work_state: string;
  operation_class: string | null;
  allocation_role: string;
  allocated_at: string;
  requirements: CompanyWorkResponsibility["requirements"] | null;
  next_target_at: string | null;
  execution_state: CompanyWorkResponsibility["executionState"];
  execution_reason: string | null;
  legacy_task_id: string | null;
  legacy_task_status: string | null;
  legacy_task_due_date: string | null;
  attention_lease_id: string | null;
  attention_lease_state: string | null;
};

function mapRow(row: CompanyWorkResponsibilityRow): CompanyWorkResponsibility {
  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationUnitId: row.organization_unit_id,
    organizationUnitKey: row.organization_unit_key,
    organizationUnitName: row.organization_unit_name,
    workItemId: row.work_item_id,
    allocationId: row.allocation_id,
    title: row.title,
    instructions: row.instructions,
    workState: row.work_state,
    operationClass: row.operation_class,
    allocationRole: row.allocation_role,
    allocatedAt: row.allocated_at,
    requirements: Array.isArray(row.requirements) ? row.requirements : [],
    nextTargetAt: row.next_target_at,
    executionState: row.execution_state,
    executionReason: row.execution_reason,
    legacyTaskId: row.legacy_task_id,
    legacyTaskStatus: row.legacy_task_status,
    legacyTaskDueDate: row.legacy_task_due_date,
    attentionLeaseId: row.attention_lease_id,
    attentionLeaseState: row.attention_lease_state,
  };
}

export async function getMyCompanyWorkResponsibilities(): Promise<CompanyWorkResponsibility[]> {
  const supabase = await createAtlasServerClient();
  const result = await supabase.rpc("company_work_self_responsibilities_api_v1");
  if (result.error) throw new Error("Atlas responsibility register read failed.");
  return ((result.data ?? []) as CompanyWorkResponsibilityRow[]).map(mapRow);
}
