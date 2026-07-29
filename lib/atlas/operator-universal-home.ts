import "server-only";

import type { AtlasPortfolioAttention, AtlasPortfolioHome, AtlasPortfolioProject } from "@/lib/atlas/portfolio";
import type { AtlasSessionMembership, AtlasSessionOrganizationMembership } from "@/lib/atlas/session";
import {
  atlasMetadataValue,
  atlasRouteKeyForTask,
  atlasRouteLabels,
  atlasTaskDisplay,
} from "@/lib/atlas/task-display";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  readAtlasUniversalHome,
  type AtlasUniversalDatedItem,
  type AtlasUniversalFarmScope,
  type AtlasUniversalHomeModel,
  type AtlasUniversalMove,
  type AtlasUniversalMoveState,
  type AtlasUniversalProjectTask,
} from "@/lib/atlas/universal-home";
import type { AtlasUniversalViewer } from "@/lib/atlas/viewer";
import { atlasWorkOrderSortValue } from "@/lib/atlas/work-order";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasOperatorUniversalHomeOptions = {
  preferredFarmId?: string | null;
  doneDate?: string;
  dueThrough?: string;
  effectiveAccountId?: string | null;
  effectiveMembershipId?: string | null;
};

type OperatorContextRow = {
  isOperating?: boolean;
  effective?: {
    accountId?: string;
    userId?: string;
    membershipId?: string | null;
    farmMembershipId?: string | null;
    farmId?: string | null;
    farmKey?: string | null;
    farmName?: string | null;
    role?: "owner" | "manager" | "farm_hand" | "consultant" | "member";
    farmRole?: "owner" | "manager" | "farm_hand" | null;
    workerKey?: string | null;
    organizationMembershipId?: string | null;
    organizationId?: string | null;
    organizationKey?: string | null;
    organizationName?: string | null;
    organizationRole?: "owner" | "consultant" | "member" | null;
    displayName?: string;
    permissions?: Record<string, unknown>;
  };
};

type OperatorHomeRpc = {
  farms?: AtlasUniversalFarmScope[];
  organizationHome?: AtlasPortfolioHome | null;
  projectTasks?: AtlasUniversalProjectTask[];
  window?: { doneDate?: string; dueThrough?: string };
  operatorContext?: OperatorContextRow;
};

type RpcError = { message?: string };

function centralDateIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDaysIso(dateIso: string, days: number) {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isChildTask(card: AtlasTaskCard) {
  return Boolean(card.parent_task_id)
    || atlasMetadataValue(card, "is_child_task") === true
    || atlasMetadataValue(card, "is_child_task") === "true";
}

function isDashboardTask(card: AtlasTaskCard) {
  const joined = `${card.task_type ?? ""} ${card.title} ${card.unlock_text ?? ""}`.toLowerCase();
  return (card.status === "open" || card.status === "blocked")
    && !isChildTask(card)
    && !(joined.includes("verify")
      || joined.includes("check")
      || joined.includes("confirm")
      || joined.includes("count")
      || joined.includes("germin")
      || joined.includes("walk field rows"));
}

function taskMove(farm: AtlasUniversalFarmScope, card: AtlasTaskCard, today: string): AtlasUniversalMove {
  const display = atlasTaskDisplay(card);
  const overdue = Boolean(card.due_date && card.due_date < today);
  return {
    key: `farm-task:${farm.farmId}:${card.task_id}`,
    kind: "farm_task",
    category: overdue ? "Overdue" : display.action || atlasRouteLabels[atlasRouteKeyForTask(card)],
    title: display.title,
    scopeLabel: farm.farmName,
    meta: display.location,
    detail: display.detail,
    href: `/task-focus/${encodeURIComponent(card.task_id)}?returnTo=${encodeURIComponent("/")}`,
    date: card.due_date,
    state: card.status === "blocked" ? "blocked" : overdue ? "attention" : "ready",
    farmId: farm.farmId,
    projectId: null,
    priority: card.status === "blocked" ? 0 : overdue ? 1 : card.due_date === today ? 2 : 6,
  };
}

function buildFarmMoves(farm: AtlasUniversalFarmScope, today: string) {
  return farm.taskCards
    .filter(isDashboardTask)
    .sort((left, right) => {
      const leftDate = left.due_date ?? "9999-12-31";
      const rightDate = right.due_date ?? "9999-12-31";
      const leftBand = leftDate <= today ? 0 : 1;
      const rightBand = rightDate <= today ? 0 : 1;
      return leftBand - rightBand
        || leftDate.localeCompare(rightDate)
        || atlasWorkOrderSortValue(left).localeCompare(atlasWorkOrderSortValue(right));
    })
    .slice(0, 4)
    .map((card) => taskMove(farm, card, today));
}

function buildFarmDatedItems(farm: AtlasUniversalFarmScope): AtlasUniversalDatedItem[] {
  return farm.taskCards
    .filter(isDashboardTask)
    .filter((card) => Boolean(card.due_date))
    .map((card) => ({
      key: `farm-task:${farm.farmId}:${card.task_id}:${card.due_date}`,
      kind: "farm_task" as const,
      title: atlasTaskDisplay(card).title,
      scopeLabel: farm.farmName,
      date: card.due_date as string,
      href: `/task-focus/${encodeURIComponent(card.task_id)}`,
      state: card.status === "blocked" ? "blocked" as const : "ready" as const,
    }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
}

function projectState(project: AtlasPortfolioProject): AtlasUniversalMoveState {
  if (project.blockedTaskCount > 0 || project.health === "blocked") return "blocked";
  if (project.openAttentionCount > 0 || project.health === "at_risk") return "attention";
  if (project.health === "waiting") return "waiting";
  if (project.health === "complete") return "complete";
  if (project.health === "quiet") return "quiet";
  return "moving";
}

function projectTaskState(task: AtlasUniversalProjectTask, today: string): AtlasUniversalMoveState {
  if (task.status === "blocked") return "blocked";
  if (task.status === "done") return "complete";
  if (task.dueDate && task.dueDate < today) return "attention";
  return "ready";
}

function collectProjects(home: AtlasPortfolioHome | null) {
  if (!home) return [];
  const projects = new Map<string, AtlasPortfolioProject>();
  home.crossFarmProjects.forEach((project) => projects.set(project.projectId, project));
  home.farms.forEach((farm) => farm.projects.forEach((project) => projects.set(project.projectId, project)));
  return [...projects.values()];
}

function projectTaskMove(task: AtlasUniversalProjectTask, today: string): AtlasUniversalMove {
  const state = projectTaskState(task, today);
  const overdue = Boolean(task.dueDate && task.dueDate < today);
  return {
    key: `project-task:${task.projectId}:${task.taskId}`,
    kind: "project_task",
    category: overdue ? "Overdue" : titleCase(task.workstream || "Project work"),
    title: task.title,
    scopeLabel: task.farmName || "Feast Guild",
    meta: `${task.projectTitle}${task.dueDate ? ` · due ${task.dueDate}` : " · current work"}`,
    detail: task.blockerText || task.note || "Open this project task.",
    href: `/project/${encodeURIComponent(task.projectId)}?taskId=${encodeURIComponent(task.taskId)}#project-work`,
    date: task.dueDate,
    state,
    farmId: task.farmId,
    projectId: task.projectId,
    priority: state === "blocked" ? 0 : overdue ? 1 : task.dueDate === today ? 2 : task.dueDate ? 5 : 3,
  };
}

function attentionMove(attention: AtlasPortfolioAttention, today: string): AtlasUniversalMove {
  const overdue = Boolean(attention.dueDate && attention.dueDate < today);
  return {
    key: `attention:${attention.attentionId ?? `${attention.projectId}:${attention.kind}:${attention.title}`}`,
    kind: "attention",
    category: titleCase(attention.kind),
    title: attention.title,
    scopeLabel: attention.farmName || "Feast Guild",
    meta: attention.projectTitle,
    detail: attention.detail || "This item needs a response before the work can move cleanly.",
    href: `/project/${encodeURIComponent(attention.projectId)}`,
    date: attention.dueDate,
    state: attention.kind === "blocked" ? "blocked" : "attention",
    farmId: null,
    projectId: attention.projectId,
    priority: attention.kind === "blocked" || overdue ? 0 : 4,
  };
}

function projectMove(project: AtlasPortfolioProject): AtlasUniversalMove {
  const state = projectState(project);
  return {
    key: `project:${project.projectId}`,
    kind: "project",
    category: titleCase(project.workstream),
    title: project.title,
    scopeLabel: project.farmName || "Feast Guild",
    meta: `${project.openTaskCount} open${project.targetDate ? ` · due ${project.targetDate}` : ""}`,
    detail: project.currentMilestone || project.outcome || "Open the project.",
    href: `/project/${encodeURIComponent(project.projectId)}`,
    date: project.targetDate,
    state,
    farmId: project.farmId,
    projectId: project.projectId,
    priority: state === "blocked" ? 1 : state === "attention" ? 4 : state === "waiting" ? 5 : 7,
  };
}

function buildOrganizationMoves(
  projects: AtlasPortfolioProject[],
  projectTasks: AtlasUniversalProjectTask[],
  attention: AtlasPortfolioAttention[],
  today: string,
) {
  const candidates: AtlasUniversalMove[] = [];
  const activeProjectIds = new Set<string>();
  projectTasks.filter((task) => task.status === "open" || task.status === "blocked").forEach((task) => {
    activeProjectIds.add(task.projectId);
    candidates.push(projectTaskMove(task, today));
  });
  attention.forEach((item) => candidates.push(attentionMove(item, today)));
  const attentionProjectIds = new Set(attention.map((item) => item.projectId));
  projects.filter((project) => !activeProjectIds.has(project.projectId) && !attentionProjectIds.has(project.projectId))
    .forEach((project) => candidates.push(projectMove(project)));
  const seen = new Set<string>();
  return candidates
    .sort((left, right) => left.priority - right.priority
      || (left.date ?? "9999-12-31").localeCompare(right.date ?? "9999-12-31")
      || left.title.localeCompare(right.title))
    .filter((move) => seen.has(move.key) ? false : (seen.add(move.key), true))
    .slice(0, 4);
}

function buildOrganizationDatedItems(
  projects: AtlasPortfolioProject[],
  projectTasks: AtlasUniversalProjectTask[],
  attention: AtlasPortfolioAttention[],
  today: string,
): AtlasUniversalDatedItem[] {
  const items: AtlasUniversalDatedItem[] = [];
  projectTasks.forEach((task) => {
    if (!task.dueDate) return;
    items.push({
      key: `project-task:${task.projectId}:${task.taskId}:${task.dueDate}`,
      kind: "project_task",
      title: task.title,
      scopeLabel: task.farmName || "Feast Guild",
      date: task.dueDate,
      href: `/project/${encodeURIComponent(task.projectId)}?taskId=${encodeURIComponent(task.taskId)}#project-work`,
      state: projectTaskState(task, today),
    });
  });
  attention.forEach((item) => {
    if (!item.dueDate) return;
    items.push({
      key: `attention:${item.attentionId ?? item.projectId}:${item.dueDate}`,
      kind: "attention",
      title: item.title,
      scopeLabel: item.farmName || "Feast Guild",
      date: item.dueDate,
      href: `/project/${encodeURIComponent(item.projectId)}`,
      state: item.kind === "blocked" ? "blocked" : "attention",
    });
  });
  const projectsWithDatedTasks = new Set(projectTasks.filter((task) => task.dueDate).map((task) => task.projectId));
  projects.forEach((project) => {
    if (!project.targetDate || projectsWithDatedTasks.has(project.projectId)) return;
    items.push({
      key: `project:${project.projectId}:${project.targetDate}`,
      kind: "project",
      title: project.title,
      scopeLabel: project.farmName || "Feast Guild",
      date: project.targetDate,
      href: `/project/${encodeURIComponent(project.projectId)}`,
      state: projectState(project),
    });
  });
  return items.sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
}

function effectiveFarmViewer(
  actor: AtlasUniversalViewer,
  farm: AtlasUniversalFarmScope,
  context: OperatorContextRow,
): AtlasUniversalViewer {
  const effective = context.effective;
  const role = effective?.farmRole ?? "farm_hand";
  const membership: AtlasSessionMembership = {
    membershipId: effective?.farmMembershipId ?? farm.membershipId,
    farmId: farm.farmId,
    farmKey: farm.farmKey,
    farmName: farm.farmName,
    farmStatus: farm.farmStatus,
    role,
    workerKey: effective?.workerKey ?? farm.workerKey,
    permissions: effective?.permissions ?? farm.permissions,
  };
  return {
    userId: effective?.userId ?? actor.userId,
    email: null,
    displayName: effective?.displayName || actor.displayName,
    activeFarmId: farm.farmId,
    activeOrganizationId: null,
    farmMemberships: [membership],
    organizationMemberships: [],
    hasFarmScope: true,
    hasOrganizationScope: false,
    canManageAnyFarm: role === "owner" || role === "manager",
    canUseAnyOwnerTools: role === "owner",
    canManageAnyPortfolio: false,
  };
}

function effectiveOrganizationViewer(actor: AtlasUniversalViewer, context: OperatorContextRow): AtlasUniversalViewer {
  const effective = context.effective;
  const role = effective?.organizationRole ?? "member";
  const organizationMemberships: AtlasSessionOrganizationMembership[] = effective?.organizationMembershipId && effective.organizationId
    ? [{
        membershipId: effective.organizationMembershipId,
        organizationId: effective.organizationId,
        organizationKey: effective.organizationKey ?? null,
        organizationName: effective.organizationName ?? "Feast Guild",
        organizationStatus: "active",
        role,
        permissions: effective.permissions ?? {},
      }]
    : [];
  return {
    userId: effective?.userId ?? actor.userId,
    email: null,
    displayName: effective?.displayName || actor.displayName,
    activeFarmId: null,
    activeOrganizationId: effective?.organizationId ?? null,
    farmMemberships: [],
    organizationMemberships,
    hasFarmScope: false,
    hasOrganizationScope: organizationMemberships.length > 0,
    canManageAnyFarm: false,
    canUseAnyOwnerTools: false,
    canManageAnyPortfolio: role === "owner",
  };
}

export async function readAtlasOperatorUniversalHome(
  viewer: AtlasUniversalViewer,
  options: AtlasOperatorUniversalHomeOptions = {},
): Promise<AtlasUniversalHomeModel> {
  const effectiveAccountId = options.effectiveAccountId?.trim() || null;
  if (!effectiveAccountId) return readAtlasUniversalHome(viewer, options);

  const doneDate = options.doneDate ?? centralDateIso();
  const dueThrough = options.dueThrough ?? addDaysIso(doneDate, 35);
  const supabase = await createAtlasServerClient();
  const response = options.effectiveMembershipId
    ? await supabase.rpc("owner_operator_universal_home_v1", {
        p_effective_membership_id: options.effectiveMembershipId,
        p_organization_id: viewer.activeOrganizationId,
        p_preferred_farm_id: options.preferredFarmId ?? viewer.activeFarmId,
        p_due_through: dueThrough,
        p_done_date: doneDate,
      })
    : await supabase.rpc("owner_operator_organization_home_v1", {
        p_effective_account_id: effectiveAccountId,
        p_organization_id: viewer.activeOrganizationId,
        p_due_through: dueThrough,
        p_done_date: doneDate,
      });
  const { data, error } = response;
  if (error || !data) throw new Error((error as RpcError | null)?.message || "Atlas owner operator home read failed.");

  const raw = data as OperatorHomeRpc;
  const context = raw.operatorContext ?? {};
  if (!context.isOperating) return readAtlasUniversalHome(viewer, options);

  const farm = Array.isArray(raw.farms) ? raw.farms[0] ?? null : null;
  if (farm) {
    const moves = buildFarmMoves(farm, doneDate);
    const datedItems = buildFarmDatedItems(farm);
    return {
      title: farm.farmName,
      viewer: effectiveFarmViewer(viewer, farm, context),
      activeFarmId: farm.farmId,
      activeFarm: farm,
      farms: [farm],
      organizationHome: null,
      projects: [],
      projectTasks: [],
      attention: [],
      moves,
      datedItems,
      metrics: {
        farmCount: 1,
        projectCount: 0,
        openWorkCount: farm.openTaskCount,
        attentionCount: farm.blockedTaskCount + farm.overdueTaskCount,
        movingCount: farm.dueTodayCount > 0 || farm.openTaskCount > 0 ? 1 : 0,
      },
      window: { doneDate: raw.window?.doneDate ?? doneDate, dueThrough: raw.window?.dueThrough ?? dueThrough },
    };
  }

  const organizationHome = raw.organizationHome ?? null;
  const projects = collectProjects(organizationHome);
  const projectTasks = Array.isArray(raw.projectTasks) ? raw.projectTasks : [];
  const attention = organizationHome?.attention ?? [];
  return {
    title: organizationHome?.organization.name ?? context.effective?.organizationName ?? "Atlas",
    viewer: effectiveOrganizationViewer(viewer, context),
    activeFarmId: null,
    activeFarm: null,
    farms: [],
    organizationHome,
    projects,
    projectTasks,
    attention,
    moves: buildOrganizationMoves(projects, projectTasks, attention, doneDate),
    datedItems: buildOrganizationDatedItems(projects, projectTasks, attention, doneDate),
    metrics: {
      farmCount: organizationHome?.farms.length ?? 0,
      projectCount: projects.length,
      openWorkCount: projects.reduce((sum, project) => sum + project.openTaskCount, 0),
      attentionCount: attention.length,
      movingCount: projects.filter((project) => projectState(project) === "moving").length,
    },
    window: { doneDate: raw.window?.doneDate ?? doneDate, dueThrough: raw.window?.dueThrough ?? dueThrough },
  };
}
