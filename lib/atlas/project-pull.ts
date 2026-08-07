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

type EnabledProject = {
  id: string;
  title: string;
  farm_id: string;
  metadata: Record<string, unknown> | null;
};

function asStatus(value: unknown): AtlasProjectPullStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const status = value as Partial<AtlasProjectPullStatus>;
  return status.contractVersion === "project_pull_status_v1" && typeof status.projectId === "string"
    ? status as AtlasProjectPullStatus
    : null;
}

function asOptions(value: unknown): AtlasProjectPullOptions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const options = value as Partial<AtlasProjectPullOptions>;
  return options.contractVersion === "project_pull_options_v1" && Array.isArray(options.options)
    ? options as AtlasProjectPullOptions
    : null;
}

export async function readAtlasProjectPullSelector(
  projectId: string,
  membershipId: string,
  day: string,
) {
  const supabase = await createAtlasServerClient();
  const [{ data: statusData, error: statusError }, { data: optionData, error: optionError }] = await Promise.all([
    supabase.rpc("project_pull_status_for_member_v1", {
      p_project_id: projectId,
      p_membership_id: membershipId,
      p_day: day,
    }),
    supabase.rpc("project_pull_options_for_member_v1", {
      p_project_id: projectId,
      p_membership_id: membershipId,
      p_day: day,
      p_limit: null,
    }),
  ]);
  if (statusError) throw new Error(statusError.message);
  if (optionError) throw new Error(optionError.message);

  const status = asStatus(statusData);
  const options = asOptions(optionData);
  if (!status || !options) throw new Error("Project pull read contract was invalid.");
  return { status, options };
}

export async function readAtlasEnabledProjectPull(
  farmId: string,
  membershipId: string,
  day: string,
) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id,title,farm_id,metadata")
    .eq("farm_id", farmId)
    .eq("status", "active")
    .contains("metadata", { daily_pull_enabled: true })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const project = (data as EnabledProject | null) ?? null;
  if (!project) return null;

  const selector = await readAtlasProjectPullSelector(project.id, membershipId, day);
  return { project, ...selector };
}

export async function buildAtlasProjectPullMove(
  farmId: string,
  membershipId: string,
  day: string,
): Promise<AtlasUniversalMove | null> {
  const result = await readAtlasEnabledProjectPull(farmId, membershipId, day);
  if (!result) return null;
  if (!result.status.enabled || result.status.completeForToday || result.status.remainingItems <= 0) return null;

  const fitting = result.options.options.filter((option) => option.fitsToday);
  if (!fitting.length) return null;

  const minutes = Math.min(
    result.status.remainingPullMinutes,
    result.options.capacity.projectPullBudgetMinutes,
  );
  return {
    key: `project-pull:${result.project.id}:${membershipId}:${day}`,
    kind: "project",
    category: "Physical progress · Choose",
    title: "Choose today’s Finish Project work",
    scopeLabel: result.project.title,
    meta: `${fitting.length} choices · up to ${minutes} min`,
    detail: "Pick one ready finish card that fits today. Anything you do not choose stays quietly in the project pool.",
    href: `/project-pull/${encodeURIComponent(result.project.id)}?membershipId=${encodeURIComponent(membershipId)}&returnTo=${encodeURIComponent("/")}`,
    date: day,
    state: "ready",
    farmId,
    projectId: result.project.id,
    priority: 3,
  };
}
