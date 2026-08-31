export type CompanyWorkManagementPosition =
  | "unassigned"
  | "allocated"
  | "waiting_dependency"
  | "planning_conflict";

export type CompanyWorkState = "open" | "completed" | "cancelled" | "superseded";

export type CompanyWorkRow = {
  organization_id: string;
  work_item_id: string;
  title: string;
  instructions: string | null;
  work_state: CompanyWorkState;
  operation_class: string | null;
  jurisdiction_key: string | null;
  source_object_type: string | null;
  source_object_id: string | null;
  created_at: string;
  updated_at: string;
  responsible_allocation_id: string | null;
  assignee_membership_id: string | null;
  allocated_at: string | null;
  time_contract_id: string | null;
  earliest_lawful_at: string | null;
  preferred_start_at: string | null;
  preferred_end_at: string | null;
  latest_lawful_at: string | null;
  hard_finish_at: string | null;
  expected_duration_minutes: number | null;
  movement_policy: string | null;
  unresolved_dependency_count: number;
  open_planning_conflict_id: string | null;
  open_planning_conflict_kind: string | null;
  open_planning_conflict_reason: string | null;
  conflict_required_by: string | null;
  management_position: CompanyWorkManagementPosition;
};

export type CompanyWorkSummary = {
  totalOpen: number;
  unassigned: number;
  allocated: number;
  waitingDependency: number;
  planningConflict: number;
};

export type CompanyWorkOrganization = {
  id: string;
  key: string | null;
  name: string | null;
  role: string;
  membershipId: string;
};

export type CompanyWorkApiSuccess = {
  ok: true;
  organization: CompanyWorkOrganization;
  summary: CompanyWorkSummary;
  companyWork: CompanyWorkRow[];
};

export function summarizeCompanyWork(rows: CompanyWorkRow[]): CompanyWorkSummary {
  const open = rows.filter((row) => row.work_state === "open");
  return {
    totalOpen: open.length,
    unassigned: open.filter((row) => row.management_position === "unassigned").length,
    allocated: open.filter((row) => row.management_position === "allocated").length,
    waitingDependency: open.filter((row) => row.management_position === "waiting_dependency").length,
    planningConflict: open.filter((row) => row.management_position === "planning_conflict").length,
  };
}
