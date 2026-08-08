import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type WorkerRoutingMode = "ready" | "keep_moving" | "make_simple" | "light_physical";

export type WorkerDayRoutingState = {
  workDate: string;
  routingMode: WorkerRoutingMode;
  selectedAt: string | null;
  recoveryMode: string;
  recoveryMovesRemaining: number;
  needsCheckIn: boolean;
};

function centralDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseRoutingState(value: unknown): WorkerDayRoutingState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const mode = typeof row.routingMode === "string" ? row.routingMode : "ready";
  if (!["ready", "keep_moving", "make_simple", "light_physical"].includes(mode)) return null;
  return {
    workDate: typeof row.workDate === "string" ? row.workDate : centralDateIso(),
    routingMode: mode as WorkerRoutingMode,
    selectedAt: typeof row.selectedAt === "string" ? row.selectedAt : null,
    recoveryMode: typeof row.recoveryMode === "string" ? row.recoveryMode : "normal",
    recoveryMovesRemaining: typeof row.recoveryMovesRemaining === "number" ? row.recoveryMovesRemaining : Number(row.recoveryMovesRemaining ?? 0) || 0,
    needsCheckIn: row.needsCheckIn === true,
  };
}

export async function getWorkerDayRoutingState(access: AtlasRoleAccess): Promise<WorkerDayRoutingState | null> {
  if (access.membership.role !== "farm_hand") return null;
  const supabase = await createAtlasServerClient();
  const result = await supabase.rpc("worker_day_routing_state_v1");
  if (result.error) throw new Error("Atlas worker routing state read failed.");
  return parseRoutingState(result.data);
}
