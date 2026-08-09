import "server-only";

import type { AtlasUniversalMove } from "@/lib/atlas/universal-home";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasProjectPullOption = {
  projectItemId: string;
  title: string;
  note: string | null;
  expectedActiveMinutes: number;
  physicalLoad: "light" | "moderate" | "heavy";
  workClass: string | null;
  environment: "indoor" | "outdoor" | "either";
  location: string | null;
  priority: string;
  fitsToday: boolean;
  activationDemand?: "low" | "medium" | "high";
  ambiguityLoad?: "low" | "medium" | "high";
  setupLoad?: "low" | "medium" | "high";
  completionClarity?: "low" | "medium" | "high";
  familiarity?: "low" | "medium" | "high";
  canFragment?: boolean;
  recoveryPreferred?: boolean;
};

export type AtlasProjectPullStatus = {
  contractVersion: "project_pull_status_v1";
  projectId: string;
  projectTitle: string;
  serviceDate: string;
  enabled: boolean;
  dailyPullMaxItems: number;
  dailyPullMinutes: number;
  usedItems: number;
  remainingItems: number;
  usedPullMinutes: number;
  remainingPullMinutes: number;
  availableItemCount: number;
  completeForToday: boolean;
};

export type AtlasProjectPullOptions = {
  contractVersion: "project_pull_options_v1";
  projectId: string;
  projectTitle: string;
  membershipId: string;
  serviceDate: string;
  workerMode?: "normal" | "recovery";
  recoveryMovesRemaining?: number;
  routingMode?: "ready" | "keep_moving" | "make_simple" | "light_physical";
  capacity: {
    regularTargetMinutes: number;
    alreadyPresentedRegularMinutes: number;
    remainingRegularMinutes: number;
    heavyMinutesSoftCap: number;
    alreadyPresentedHeavyMinutes: number;
    projectPullBudgetMinutes: number;
  };
  options: AtlasProjectPullOption[];
};

type EnabledProject = { id: string; title: string; farm_id: string; metadata: Record<string, unknown> | null };
type PaidProjectConveyorResult = {
  contractVersion?: string;
  state?: string;
  taskId?: string | null;
};

function asStatus(value: unknown): AtlasProjectPullStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = value as Partial<AtlasProjectPullStatus>;
  return status.contractVersion === "project_pull_status_v1" && typeof status.projectId === "string" ? status as AtlasProjectPullStatus : null;
}

function asOptions(value: unknown): AtlasProjectPullOptions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const options = value as Partial<AtlasProjectPullOptions>;
  return options.contractVersion === "project_pull_options_v1" && Array.isArray(options.options) ? options as AtlasProjectPullOptions : null;
}

export async function readAtlasProjectPullSelector(projectId: string, membershipId: string, day: string) {
  const supabase = await createAtlasServerClient();
  const [{ data: statusData, error: statusError }, { data: optionData, error: optionError }] = await Promise.all([
    supabase.rpc("project_pull_status_for_member_v1", { p_project_id: projectId, p_membership_id: membershipId, p_day: day }),
    supabase.rpc("project_pull_options_for_member_v2", { p_project_id: projectId, p_membership_id: membershipId, p_day: day, p_limit: null }),
  ]);
  if (statusError) throw new Error(statusError.message);
  if (optionError) throw new Error(optionError.message);
  const status = asStatus(statusData);
  const options = asOptions(optionData);
  if (!status || !options) throw new Error("Project pull read contract was invalid.");
  return { status, options };
}

export async function readAtlasEnabledProjectPull(farmId: string, membershipId: string, day: string) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.from("projects").select("id,title,farm_id,metadata").eq("farm_id", farmId).eq("status", "active").contains("metadata", { daily_pull_enabled: true }).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const project = (data as EnabledProject | null) ?? null;
  if (!project) return null;
  const selector = await readAtlasProjectPullSelector(project.id, membershipId, day);
  return { project, ...selector };
}

export async function ensureAtlasProjectPullTask(
  farmId: string,
  membershipId: string,
  day: string,
  constraints: { allowOutdoor?: boolean } = {},
): Promise<string | null> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("deal_next_paid_project_work_v1", {
    p_farm_id: farmId,
    p_membership_id: membershipId,
    p_day: day,
    p_allow_outdoor: constraints.allowOutdoor !== false,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const result = data as PaidProjectConveyorResult;
  return typeof result.taskId === "string" ? result.taskId : null;
}

export async function buildAtlasProjectPullMove(farmId: string, membershipId: string, day: string): Promise<AtlasUniversalMove | null> {
  const result = await readAtlasEnabledProjectPull(farmId, membershipId, day);
  if (!result) return null;
  if (!result.status.enabled || result.status.completeForToday || result.status.remainingItems <= 0) return null;
  const fitting = result.options.options.filter((option) => option.fitsToday);
  if (!fitting.length) return null;
  const minutes = Math.min(result.status.remainingPullMinutes, result.options.capacity.projectPullBudgetMinutes);
  return {
    key: `project-pull:${result.project.id}:${membershipId}:${day}`,
    kind: "project",
    category: "Physical progress · Atlas holds the order",
    title: "Finish + Renovation",
    scopeLabel: result.project.title,
    meta: `${fitting.length} ready cards · ${minutes} paid-work min remain`,
    detail: "Atlas can plan several Finish Project moves to fill the paid workday, while releasing only one actionable project serving at a time.",
    href: `/project/${encodeURIComponent(result.project.id)}`,
    date: day,
    state: "ready",
    farmId,
    projectId: result.project.id,
    priority: 3,
  };
}
