export type CompanyWorkPlanningState =
  | "unassigned"
  | "assigned_unscheduled"
  | "needs_replan"
  | "scheduled";

export type CompanyWorkAttentionState =
  | "worker_exception"
  | "needs_replan"
  | "needs_responsibility"
  | "needs_schedule"
  | "none";

export type CompanyWorkPlanningQueueItem = {
  work_item_id: string;
  title: string;
  operation_class: string | null;
  work_state: string;
  responsibility_state: "assigned" | "unassigned";
  responsible_membership_id: string | null;
  responsible_user_id: string | null;
  allocation_id: string | null;
  planning_state: CompanyWorkPlanningState;
  planned_service_date: string | null;
  exposure_service_date: string | null;
  first_planned_service_date: string | null;
  rollover_count: number;
  next_target_at: string | null;
  hard_finish_at: string | null;
  result_contract_key: string | null;
  open_conflicts: number;
  latest_result_kind: string | null;
  latest_result_at: string | null;
  latest_result_payload: unknown;
  attention_state: CompanyWorkAttentionState;
};

export type CompanyWorkPlanningOrganization = {
  id: string;
  key: string | null;
  name: string | null;
  role: string;
  membershipId: string;
};

export type CompanyWorkPlanningQueueSuccess = {
  ok: true;
  organization: CompanyWorkPlanningOrganization;
  weekStart: string;
  weekEnd: string;
  companyWork: CompanyWorkPlanningQueueItem[];
};

export type CompanyWorkPlanDraft = {
  workItemId: string;
  serviceDate: string;
  reason?: string | null;
};

export function mondayForDate(date: Date) {
  const value = new Date(date);
  value.setHours(12, 0, 0, 0);
  const day = value.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + delta);
  return value;
}

export function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

export function toLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}
