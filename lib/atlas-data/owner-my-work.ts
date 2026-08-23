import { addDaysIso, centralDateIso } from "@/lib/atlas/date";
import { buildOwnerMyWorkProjection } from "@/lib/atlas/owner-my-work-core.js";
import { readAtlasPrincipalSelfContext } from "@/lib/atlas/principal-self-context";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type OwnerMyWorkBucket = "now" | "today" | "thisWeek" | "waiting" | "backlog";

export type OwnerMyWorkPrincipalSignal = {
  sourceType: string;
  floorClass: number | null;
  expectedMinutes: number | null;
  domain: string | null;
  timingDate: string | null;
  timingKind: string;
};

export type OwnerMyWorkItem = {
  key: string;
  source: "task" | "principal";
  sourceType: string;
  sourceId: string;
  title: string;
  status: string;
  bucket: OwnerMyWorkBucket;
  href: string;
  detail: string | null;
  timingDate: string | null;
  timingKind: string;
  isOverdue: boolean;
  responsibility: "assigned_to_you" | "owner_scope" | "principal_required";
  priority: string;
  priorityRank: number;
  expectedMinutes?: number | null;
  domain?: string | null;
  principalSignal: OwnerMyWorkPrincipalSignal | null;
};

export type OwnerMyWorkProjection = {
  farm: {
    id: string;
    key: string | null;
    name: string;
  };
  generatedForDate: string;
  weekEndDate: string;
  principalSourceState: "ready" | "unavailable";
  buckets: {
    now: OwnerMyWorkItem[];
    today: OwnerMyWorkItem[];
    thisWeek: OwnerMyWorkItem[];
    waiting: OwnerMyWorkItem[];
    backlog: OwnerMyWorkItem[];
  };
  all: OwnerMyWorkItem[];
  counts: {
    all: number;
    now: number;
    today: number;
    thisWeek: number;
    waiting: number;
    backlog: number;
    overdue: number;
    taskItems: number;
    principalItems: number;
    principalLinkedTaskItems: number;
  };
  audit: {
    taskRowsRead: number;
    principalCandidatesRead: number;
    assignedTaskCount: number;
    ownerScopeTaskCount: number;
    excludedTaskRows: number;
    excludedPrincipalCandidates: number;
    linkedPrincipalCandidates: number;
    bucketedItems: number;
    unexplainedItems: number;
  };
};

type OwnerWorkTaskRow = {
  id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  note: string | null;
  visibility_scope: string;
  assigned_membership_id: string | null;
  assigned_user_id: string | null;
  parent_task_id: string | null;
  metadata: Record<string, unknown> | null;
};

type OperationalEscalationRow = {
  id: string;
  source_type: string;
  source_id: string;
  escalation_kind: string;
  current_state: Record<string, unknown> | null;
  owner_decision_required: string | null;
  consequence: string | null;
  reason_for_floor: string | null;
  floor_class: number | null;
  expected_owner_minutes: number | null;
  metadata: Record<string, unknown> | null;
};

const OWNER_WORK_TASK_FIELDS = [
  "id",
  "title",
  "task_type",
  "status",
  "priority",
  "due_date",
  "unlock_text",
  "blocker_text",
  "note",
  "visibility_scope",
  "assigned_membership_id",
  "assigned_user_id",
  "parent_task_id",
  "metadata",
].join(", ");

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export async function getOwnerMyWork(access: AtlasRoleAccess): Promise<OwnerMyWorkProjection> {
  if (access.membership.role !== "owner") {
    throw new Error("Owner membership required.");
  }

  const today = centralDateIso();
  const weekEnd = addDaysIso(today, 6);
  const supabase = await createAtlasServerClient();
  const ownerMembershipId = access.membership.membershipId;
  const ownerUserId = access.session.userId;

  const [taskResult, principalRead, escalationResult] = await Promise.all([
    supabase
      .from("tasks")
      .select(OWNER_WORK_TASK_FIELDS)
      .eq("farm_id", access.membership.farmId)
      .in("status", ["open", "blocked"])
      .or(`assigned_membership_id.eq.${ownerMembershipId},assigned_user_id.eq.${ownerUserId},visibility_scope.eq.owner`)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(1000),
    readAtlasPrincipalSelfContext()
      .then((context) => ({ state: "ready" as const, context }))
      .catch(() => ({ state: "unavailable" as const, context: null })),
    supabase
      .from("operational_escalations")
      .select("id, source_type, source_id, escalation_kind, current_state, owner_decision_required, consequence, reason_for_floor, floor_class, expected_owner_minutes, metadata")
      .eq("status", "open")
      .eq("source_system", "farm_clock")
      .eq("source_type", "worker_task_execution_readiness")
      .limit(250),
  ]);

  if (taskResult.error) {
    throw new Error("Atlas Owner My Work task read failed.");
  }

  const taskRows = (taskResult.data ?? []) as unknown as OwnerWorkTaskRow[];
  const tasks = taskRows.map((task) => ({
    id: task.id,
    title: task.title,
    taskType: task.task_type,
    status: task.status,
    priority: task.priority,
    dueDate: task.due_date,
    detail: task.note || task.unlock_text,
    blocker: task.blocker_text,
    visibilityScope: task.visibility_scope,
    assignedMembershipId: task.assigned_membership_id,
    assignedUserId: task.assigned_user_id,
    parentTaskId: task.parent_task_id,
    metadata: task.metadata ?? {},
  }));

  const farmReadinessCandidates = escalationResult.error
    ? []
    : ((escalationResult.data ?? []) as unknown as OperationalEscalationRow[])
      .filter((row) => text(row.metadata?.farmId) === access.membership.farmId)
      .map((row) => {
        const state = row.current_state ?? {};
        const taskTitle = text(state.taskTitle) || "Worker task";
        const readinessKind = text(state.readinessKind);
        const title = readinessKind === "destination"
          ? `${taskTitle} needs a planting destination`
          : `${taskTitle} needs Owner readiness`;
        return {
          ownerRequired: true,
          sourceType: row.source_type,
          sourceId: row.source_id,
          title,
          consequence: row.owner_decision_required || row.consequence || null,
          reasonForFloor: row.reason_for_floor,
          fixedStart: today,
          windowStart: null,
          mustBeginBy: null,
          mustFinishBy: null,
          windowEnd: null,
          floorClass: row.floor_class,
          expectedMinutes: row.expected_owner_minutes,
          domain: "farm_operations",
        };
      });

  const principalCandidates = [
    ...(principalRead.context?.clockCandidates ?? []),
    ...farmReadinessCandidates,
  ];
  const principalTimeZone = principalRead.context?.principal?.homeTimezone ?? "UTC";
  const core = buildOwnerMyWorkProjection({
    ownerMembershipId,
    ownerUserId,
    tasks,
    principalCandidates,
    today,
    weekEnd,
    principalTimeZone,
  }) as Omit<OwnerMyWorkProjection, "farm" | "generatedForDate" | "weekEndDate" | "principalSourceState">;

  return {
    farm: {
      id: access.membership.farmId,
      key: access.membership.farmKey,
      name: access.membership.farmName || access.membership.farmKey || "Farm",
    },
    generatedForDate: today,
    weekEndDate: weekEnd,
    principalSourceState: principalRead.state,
    ...core,
  };
}
