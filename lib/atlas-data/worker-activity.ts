import "server-only";

import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import type {
  AtlasWorkerActivityLog,
  AtlasWorkerActivityWriteResult,
} from "@/lib/atlas/worker-activity-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

type WriteRow = {
  field_log_id: string;
  actor_membership_id: string;
  logged_at: string;
  replayed: boolean;
};

export async function recordWorkerActivity(
  access: AtlasRoleAccess,
  input: {
    logDate: string;
    rawText: string;
    idempotencyKey: string;
    clockNowTaskId?: string | null;
    clockNowStartAt?: string | null;
    clockNowEndAt?: string | null;
    clockProjectionRevision?: string | null;
  },
): Promise<AtlasWorkerActivityWriteResult> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("record_worker_activity_log_v1", {
    p_farm_id: access.membership.farmId,
    p_log_date: input.logDate,
    p_summary_sentence: input.rawText,
    p_idempotency_key: input.idempotencyKey,
    p_clock_now_task_id: input.clockNowTaskId ?? null,
    p_clock_now_start_at: input.clockNowStartAt ?? null,
    p_clock_now_end_at: input.clockNowEndAt ?? null,
    p_clock_projection_revision: input.clockProjectionRevision ?? null,
  });
  if (error) throw new Error(error.message || "Atlas could not save this work log.");
  const row = ((data ?? []) as WriteRow[])[0];
  if (!row?.field_log_id || !row.actor_membership_id || !row.logged_at) {
    throw new Error("Atlas did not return the saved work log.");
  }
  return {
    activityLogId: row.field_log_id,
    actorMembershipId: row.actor_membership_id,
    loggedAt: row.logged_at,
    replayed: row.replayed === true,
  };
}

export async function readWorkerActivityDay(input: {
  farmId: string;
  membershipId: string;
  date: string;
}) {
  const supabase = await createAtlasServerClient();
  const [activityResult, journalResult] = await Promise.all([
    supabase.rpc("worker_activity_logs_for_day_v1", {
      p_farm_id: input.farmId,
      p_membership_id: input.membershipId,
      p_day: input.date,
    }),
    supabase.rpc("journal_day_for_membership_v1", {
      p_farm_id: input.farmId,
      p_membership_id: input.membershipId,
      p_day: input.date,
    }),
  ]);
  if (activityResult.error) throw new Error(activityResult.error.message || "Atlas could not read worker activity.");
  if (journalResult.error) throw new Error(journalResult.error.message || "Atlas could not read the day journal.");

  const journal = (journalResult.data ?? {}) as {
    events?: Array<Record<string, unknown>>;
    summary?: { open?: number; done?: number };
  };
  return {
    activityLogs: (activityResult.data ?? []) as AtlasWorkerActivityLog[],
    journalEvents: Array.isArray(journal.events) ? journal.events : [],
    plannedOpen: Number(journal.summary?.open ?? 0),
    plannedDone: Number(journal.summary?.done ?? 0),
  };
}

export async function retractWorkerActivity(activityLogId: string) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("retract_worker_activity_log_v1", {
    p_field_log_id: activityLogId,
  });
  if (error) throw new Error(error.message || "Atlas could not undo this work log.");
  return data === true;
}
