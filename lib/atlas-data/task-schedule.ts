import {
  addScheduleDays,
  buildTaskScheduleProjection,
} from "@/lib/atlas/task-schedule-core.js";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type TaskScheduleProjection = ReturnType<typeof buildTaskScheduleProjection>;

export type TaskScheduleOptions = {
  startDate: string;
  endDate: string;
  includeOverdue?: boolean;
  includeUndated?: boolean;
  targetMembershipId?: string | null;
};

type TaskScheduleRow = {
  task_id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  instruction: string | null;
  blocker_text: string | null;
  zone_id: string | null;
  zone_key: string | null;
  zone_label: string | null;
  object_id: string | null;
  object_key: string | null;
  object_label: string | null;
  assigned_membership_id: string | null;
  assigned_display_name: string;
  assigned_worker_key: string | null;
  visibility_scope: string;
  schedule_lane:
    | "completed"
    | "blocked"
    | "overdue"
    | "undated"
    | "today"
    | "scheduled";
  total_steps: number | string;
  completed_steps: number | string;
  can_act: boolean;
  counts_for_window: boolean;
};

function validateIsoDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be an ISO date.`);
  }
}

export async function getTaskSchedule(
  access: AtlasRoleAccess,
  options: TaskScheduleOptions,
): Promise<TaskScheduleProjection> {
  validateIsoDate(options.startDate, "Schedule start date");
  validateIsoDate(options.endDate, "Schedule end date");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("task_schedule_v1", {
    p_farm_id: access.membership.farmId,
    p_start_date: options.startDate,
    p_end_date: options.endDate,
    p_include_overdue: options.includeOverdue ?? false,
    p_include_undated: options.includeUndated ?? false,
    p_target_membership_id: options.targetMembershipId ?? null,
  });

  if (error) {
    throw new Error("Atlas task schedule read failed.");
  }

  return buildTaskScheduleProjection({
    rows: (data ?? []) as TaskScheduleRow[],
    startDate: options.startDate,
    endDate: options.endDate,
  }) as TaskScheduleProjection;
}

export async function getDaySchedule(
  access: AtlasRoleAccess,
  date: string,
  targetMembershipId: string | null = null,
): Promise<TaskScheduleProjection> {
  return getTaskSchedule(access, {
    startDate: date,
    endDate: date,
    includeOverdue: true,
    includeUndated: true,
    targetMembershipId,
  });
}

export async function getWeekSchedule(
  access: AtlasRoleAccess,
  startDate: string,
  targetMembershipId: string | null = null,
): Promise<TaskScheduleProjection> {
  return getTaskSchedule(access, {
    startDate,
    endDate: addScheduleDays(startDate, 6),
    includeOverdue: true,
    includeUndated: false,
    targetMembershipId,
  });
}

export async function getMonthSchedule(
  access: AtlasRoleAccess,
  startDate: string,
  endDate: string,
  targetMembershipId: string | null = null,
): Promise<TaskScheduleProjection> {
  return getTaskSchedule(access, {
    startDate,
    endDate,
    includeOverdue: false,
    includeUndated: false,
    targetMembershipId,
  });
}
