import "server-only";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";
import { resolveOwnerWorkerDayPlanningTarget } from "@/lib/atlas/worker-day-plan-server";

export type AtlasDayWindow = "morning" | "afternoon" | "evening";
export type AtlasDayCueKind = "briefing" | "requirement" | "observation" | "somatic" | "result";
export type AtlasDayCueAnchorKind = "first_open" | "before_task" | "after_task" | "at_time";
export type AtlasDayCueStatus = "waiting" | "available" | "unseen" | "stale" | "resolved" | "dismissed";

export type AtlasDayTaskPlacement = {
  placementId: string;
  taskId: string;
  serviceDate: string;
  dayWindow: AtlasDayWindow;
  sortOrder: number;
  placementSource: "atlas" | "owner";
  placementReason: string | null;
  state: "placed" | "returned_to_atlas";
  plannedStartAt: string | null;
};

export type AtlasDayCue = {
  cueId: string;
  serviceDate: string;
  cueKind: AtlasDayCueKind;
  anchorKind: AtlasDayCueAnchorKind;
  anchorTaskId: string | null;
  scheduledAt: string | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  status: AtlasDayCueStatus;
  recoveryPolicy: "refresh" | "expire" | "persist" | "block";
  availableFrom: string | null;
  expiresAt: string | null;
  response: Record<string, unknown> | null;
  resolvedAt: string | null;
};

export type AtlasDayChoreography = {
  contractVersion: string;
  farmId: string;
  membershipId: string;
  serviceDate: string;
  placements: AtlasDayTaskPlacement[];
  placementOverrides: AtlasDayTaskPlacement[];
  cues: AtlasDayCue[];
};

export type AtlasDayChoreographyTarget = {
  farmId: string;
  membershipId: string;
  displayName: string;
  source: "operator_lens" | "owner_direct" | "worker_self";
};

function validDateIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizePlacement(value: unknown): AtlasDayTaskPlacement | null {
  const row = object(value);
  if (!row || typeof row.placementId !== "string" || typeof row.taskId !== "string" || typeof row.serviceDate !== "string") return null;
  const dayWindow = row.dayWindow;
  if (dayWindow !== "morning" && dayWindow !== "afternoon" && dayWindow !== "evening") return null;
  return {
    placementId: row.placementId,
    taskId: row.taskId,
    serviceDate: row.serviceDate,
    dayWindow,
    sortOrder: Number(row.sortOrder) || 0,
    placementSource: row.placementSource === "owner" ? "owner" : "atlas",
    placementReason: nullableString(row.placementReason),
    state: row.state === "returned_to_atlas" ? "returned_to_atlas" : "placed",
    plannedStartAt: nullableString(row.plannedStartAt),
  };
}

function normalizePlacements(value: unknown) {
  return Array.isArray(value)
    ? value.map(normalizePlacement).filter((item): item is AtlasDayTaskPlacement => Boolean(item))
    : [];
}

function normalizeCue(value: unknown): AtlasDayCue | null {
  const row = object(value);
  if (!row || typeof row.cueId !== "string" || typeof row.serviceDate !== "string" || typeof row.title !== "string") return null;
  const cueKind = row.cueKind;
  const anchorKind = row.anchorKind;
  if (!["briefing","requirement","observation","somatic","result"].includes(String(cueKind))) return null;
  if (!["first_open","before_task","after_task","at_time"].includes(String(anchorKind))) return null;
  const payload = object(row.payload) ?? {};
  const response = object(row.response);
  const recovery = ["refresh","expire","persist","block"].includes(String(row.recoveryPolicy)) ? row.recoveryPolicy as AtlasDayCue["recoveryPolicy"] : "refresh";
  const status = ["waiting","available","unseen","stale","resolved","dismissed"].includes(String(row.status)) ? row.status as AtlasDayCueStatus : "waiting";
  return {
    cueId: row.cueId,
    serviceDate: row.serviceDate,
    cueKind: cueKind as AtlasDayCueKind,
    anchorKind: anchorKind as AtlasDayCueAnchorKind,
    anchorTaskId: nullableString(row.anchorTaskId),
    scheduledAt: nullableString(row.scheduledAt),
    title: row.title,
    body: nullableString(row.body),
    payload,
    status,
    recoveryPolicy: recovery,
    availableFrom: nullableString(row.availableFrom),
    expiresAt: nullableString(row.expiresAt),
    response,
    resolvedAt: nullableString(row.resolvedAt),
  };
}

function normalizeChoreography(value: unknown): AtlasDayChoreography {
  const row = object(value);
  if (!row) throw new Error("Atlas returned invalid Day choreography.");
  return {
    contractVersion: String(row.contractVersion || "worker_day_choreography_v1"),
    farmId: String(row.farmId || ""),
    membershipId: String(row.membershipId || ""),
    serviceDate: String(row.serviceDate || ""),
    placements: normalizePlacements(row.placements),
    placementOverrides: normalizePlacements(row.placementOverrides),
    cues: Array.isArray(row.cues) ? row.cues.map(normalizeCue).filter((item): item is AtlasDayCue => Boolean(item)) : [],
  };
}

export async function resolveDayChoreographyTarget(): Promise<AtlasDayChoreographyTarget | null> {
  const ownerTarget = await resolveOwnerWorkerDayPlanningTarget();
  if (ownerTarget) return ownerTarget;

  const session = await getAtlasSession();
  if (!session) return null;
  const farmId = session.activeFarmId ?? session.memberships.find((membership) => membership.role === "farm_hand")?.farmId ?? null;
  if (!farmId) return null;
  const worker = session.memberships.find((membership) => membership.farmId === farmId && membership.role === "farm_hand");
  if (!worker) return null;

  return {
    farmId,
    membershipId: worker.membershipId,
    displayName: session.displayName || "Farm Hand",
    source: "worker_self",
  };
}

export async function readWorkerDayChoreography(dateIso: string) {
  if (!validDateIso(dateIso)) throw new Error("A valid YYYY-MM-DD Day is required.");
  const target = await resolveDayChoreographyTarget();
  if (!target) return { active: false as const, target: null, choreography: null };

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_day_choreography_api_v1", {
    p_farm_id: target.farmId,
    p_membership_id: target.membershipId,
    p_day: dateIso,
  });
  if (error) throw new Error(error.message);

  return {
    active: true as const,
    target,
    choreography: normalizeChoreography(data),
  };
}

export const readOwnerWorkerDayChoreography = readWorkerDayChoreography;
