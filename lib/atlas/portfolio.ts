import "server-only";

import {
  effectiveOperatorAccountId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import type { AtlasTrailContext } from "@/lib/atlas/trail";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasPortfolioTarget = {
  targetRole: string;
  farmId: string | null;
  farmName: string | null;
  placeId: string | null;
  placeLabel: string | null;
  placeType: string | null;
  zoneId: string | null;
  zoneLabel: string | null;
};

export type AtlasPortfolioProject = {
  projectId: string;
  projectKey: string;
  title: string;
  status: string;
  projectKind: "farm" | "cross_farm" | "organization" | string;
  workstream: string;
  outcome: string | null;
  currentMilestone: string | null;
  health: "moving" | "waiting" | "blocked" | "at_risk" | "complete" | "quiet" | string;
  targetDate: string | null;
  lastMovementAt: string | null;
  farmId: string | null;
  farmKey: string | null;
  farmName: string | null;
  myRole: string | null;
  canCreateTasks: boolean;
  openTaskCount: number;
  blockedTaskCount: number;
  openAttentionCount: number;
  targets: AtlasPortfolioTarget[];
  trail: AtlasTrailContext | null;
};

export type AtlasPortfolioFarm = {
  farmId: string;
  farmKey: string;
  farmName: string;
  status: string;
  facts: Record<string, unknown>;
  projects: AtlasPortfolioProject[];
};

export type AtlasPortfolioAttention = {
  attentionId: string | null;
  kind: string;
  title: string;
  detail: string | null;
  dueDate: string | null;
  projectId: string;
  projectTitle: string;
  farmName: string | null;
};

export type AtlasPortfolioHome = {
  organization: { organizationId: string; organizationKey: string; name: string };
  viewer: { role: string; isOwner: boolean };
  workstreams: string[];
  attention: AtlasPortfolioAttention[];
  crossFarmProjects: AtlasPortfolioProject[];
  farms: AtlasPortfolioFarm[];
};

export type AtlasProjectTask = {
  taskId: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  note: string | null;
  blockerText: string | null;
  taskType?: string | null;
  taskScope?: string | null;
  metadata?: Record<string, unknown> | null;
  assignedToViewer: boolean;
  createdByViewer: boolean;
  originKind: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

export type AtlasProjectStep = {
  stepId: string;
  title: string;
  status: string;
  stepOrder: number;
  linkedTaskId: string | null;
  note: string | null;
};

export type AtlasProjectAttention = {
  attentionId: string;
  kind: string;
  title: string;
  detail: string | null;
  dueDate: string | null;
  status: string;
};

export type AtlasProjectDetail = {
  project: AtlasPortfolioProject;
  permissions: { canCreateTasks: boolean; isOrganizationOwner: boolean };
  tasks: AtlasProjectTask[];
  steps: AtlasProjectStep[];
  attention: AtlasProjectAttention[];
};

export type AtlasProjectTaskFocus = {
  organizationName: string;
  project: AtlasPortfolioProject;
  task: AtlasProjectTask;
  step: AtlasProjectStep | null;
  permissions: { canComplete: boolean; canEdit: boolean; isOrganizationOwner: boolean };
};

type RpcError = { message?: string };
type OperatorHomeResult = { organizationHome?: AtlasPortfolioHome | null };

export async function readAtlasPortfolioHome(organizationId: string): Promise<AtlasPortfolioHome> {
  const operatorContext = await readAtlasOwnerOperatorContext();
  const effectiveAccountId = effectiveOperatorAccountId(operatorContext);
  const supabase = await createAtlasServerClient();
  const { data, error } = effectiveAccountId
    ? await supabase.rpc("owner_operator_organization_home_v1", {
        p_effective_account_id: effectiveAccountId,
        p_organization_id: organizationId,
      })
    : await supabase.rpc("portfolio_home_v1", { p_organization_id: organizationId });

  if (error || !data) throw new Error((error as RpcError | null)?.message || "Feast Guild portfolio read failed.");
  if (effectiveAccountId) {
    const home = (data as OperatorHomeResult).organizationHome;
    if (!home) throw new Error("The selected account has no visible portfolio.");
    return home;
  }
  return data as AtlasPortfolioHome;
}

export async function readAtlasProjectDetail(projectId: string): Promise<AtlasProjectDetail> {
  const operatorContext = await readAtlasOwnerOperatorContext();
  const effectiveAccountId = effectiveOperatorAccountId(operatorContext);
  const supabase = await createAtlasServerClient();
  const { data, error } = effectiveAccountId
    ? await supabase.rpc("owner_operator_project_detail_v1", {
        p_effective_account_id: effectiveAccountId,
        p_project_id: projectId,
      })
    : await supabase.rpc("project_detail_v1", { p_project_id: projectId });

  if (error || !data) throw new Error((error as RpcError | null)?.message || "Atlas project read failed.");
  return data as AtlasProjectDetail;
}

export async function readAtlasProjectTaskFocus(taskId: string): Promise<AtlasProjectTaskFocus | null> {
  const operatorContext = await readAtlasOwnerOperatorContext();
  const effectiveAccountId = effectiveOperatorAccountId(operatorContext);
  const supabase = await createAtlasServerClient();
  const { data, error } = effectiveAccountId
    ? await supabase.rpc("owner_operator_project_task_focus_v1", {
        p_effective_account_id: effectiveAccountId,
        p_task_id: taskId,
      })
    : await supabase.rpc("project_task_focus_v1", { p_task_id: taskId });

  if (error) throw new Error((error as RpcError | null)?.message || "Atlas project task read failed.");
  return data ? data as AtlasProjectTaskFocus : null;
}
