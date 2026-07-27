import "server-only";

import type { AtlasPortfolioAttention, AtlasPortfolioHome, AtlasPortfolioProject } from "@/lib/atlas/portfolio";
import {
  atlasMetadataValue,
  atlasMetaString,
  atlasRouteKeyForTask,
  atlasRouteLabels,
  atlasTaskDisplay,
} from "@/lib/atlas/task-display";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { AtlasUniversalViewer } from "@/lib/atlas/viewer";
import { atlasWorkOrderSortValue } from "@/lib/atlas/work-order";
import {
  atlasBuildMowingCollectionSummary,
  atlasIsMowingCollectionMember,
} from "@/lib/atlas/work-collections";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasUniversalFarmSnapshot = {
  totalBeds: number;
  growingBeds: number;
  activeSqft: number;
  sowingsLogged: number;
  stemsLogged: number;
};

export type AtlasUniversalFarmScope = {
  membershipId: string;
  farmId: string;
  farmKey: string;
  farmName: string;
  farmStatus: string;
  organizationId: string | null;
  role: string;
  workerKey: string | null;
  permissions: Record<string, unknown>;
  canManageFarm: boolean;
  canUseOwnerTools: boolean;
  snapshot: AtlasUniversalFarmSnapshot;
  taskCards: AtlasTaskCard[];
  openTaskCount: number;
  blockedTaskCount: number;
  overdueTaskCount: number;
  dueTodayCount: number;
  lastMovementAt: string | null;
};

export type AtlasUniversalProjectTask = {
  taskId: string;
  projectId: string;
  projectKey: string;
  projectTitle: string;
  farmId: string | null;
  farmKey: string | null;
  farmName: string | null;
  workstream: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  note: string | null;
  blockerText: string | null;
  assignedToViewer: boolean;
  createdByViewer: boolean;
  originKind: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type AtlasUniversalMoveState =
  | "ready"
  | "moving"
  | "waiting"
  | "blocked"
  | "review"
  | "complete"
  | "quiet"
  | "attention";

export type AtlasUniversalMove = {
  key: string;
  kind: "farm_task" | "collection" | "project_task" | "project" | "attention";
  category: string;
  title: string;
  scopeLabel: string;
  meta: string;
  detail: string;
  href: string;
  date: string | null;
  state: AtlasUniversalMoveState;
  farmId: string | null;
  projectId: string | null;
  priority: number;
};

export type AtlasUniversalDatedItem = {
  key: string;
  kind: "farm_task" | "project_task" | "project" | "attention";
  title: string;
  scopeLabel: string;
  date: string;
  href: string;
  state: AtlasUniversalMoveState;
};

export type AtlasUniversalHomeMetrics = {
  farmCount: number;
  projectCount: number;
  openWorkCount: number;
  attentionCount: number;
  movingCount: number;
};

export type AtlasUniversalHomeModel = {
  title: string;
  viewer: AtlasUniversalViewer;
  activeFarmId: string | null;
  activeFarm: AtlasUniversalFarmScope | null;
  farms: AtlasUniversalFarmScope[];
  organizationHome: AtlasPortfolioHome | null;
  projects: AtlasPortfolioProject[];
  projectTasks: AtlasUniversalProjectTask[];
  attention: AtlasPortfolioAttention[];
  moves: AtlasUniversalMove[];
  datedItems: AtlasUniversalDatedItem[];
  metrics: AtlasUniversalHomeMetrics;
  window: {
    doneDate: string;
    dueThrough: string;
  };
};

type UniversalHomeRpc = {
  viewer?: {
    activeFarmId?: string | null;
  };
  organizationHome?: AtlasPortfolioHome | null;
  farms?: AtlasUniversalFarmScope[];
  projectTasks?: AtlasUniversalProjectTask[];
  window?: {
    doneDate?: string;
    dueThrough?: string;
  };
};

type UniversalHomeOptions = {
  preferredFarmId?: string | null;
  doneDate?: string;
  dueThrough?: string;
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
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function projectState(project: AtlasPortfolioProject): AtlasUniversalMoveState {
  if (project.blockedTaskCount > 0 || project.health === "blocked") return "blocked";
  if (project.openAttentionCount > 0 || project.health === "at_risk") return "attention";
  if (project.health === "waiting") return "waiting";
  if (project.health === "complete") return "complete";
  if (project.health === "quiet") return "quiet";
  return "moving";
}

function attentionState(attention: AtlasPortfolioAttention): AtlasUniversalMoveState {
  return attention.kind === "blocked" ? "blocked" : "attention";
}

function projectTaskState(task: AtlasUniversalProjectTask, today: string): AtlasUniversalMoveState {
  if (task.status === "blocked") return "blocked";
  if (task.status === "done") return "complete";
  if (task.dueDate && task.dueDate < today) return "attention";
  return "ready";
}

function isChildTask(card: AtlasTaskCard) {
  return Boolean(card.parent_task_id)
    || atlasMetadataValue(card, "is_child_task") === true
    || atlasMetadataValue(card, "is_child_task") === "true";
}

function isActiveChecklistChild(card: AtlasTaskCard) {
  if (!isChildTask(card)) return false;
  const checklistStatus = (atlasMetaString(card, "checklist_status") ?? "").toLowerCase();
  const atlasStatus = (atlasMetaString(card, "atlas_status") ?? "").toLowerCase();
  const relevance = (atlasMetaString(card, "relevance") ?? "").toLowerCase();
  return card.status !== "archived"
    && checklistStatus !== "archived"
    && atlasStatus !== "not_relevant"
    && relevance !== "not_relevant";
}

function isDashboardTask(card: AtlasTaskCard) {
  const text = `${card.task_type} ${card.title} ${card.unlock_text ?? ""}`.toLowerCase();
  return (card.status === "open" || card.status === "blocked")
    && !isChildTask(card)
    && !(text.includes("verify")
      || text.includes("check")
      || text.includes("confirm")
      || text.includes("count")
      || text.includes("germin")
      || text.includes("walk field rows"));
}

function subtaskCounts(cards: AtlasTaskCard[]) {
  const counts = new Map<string, number>();
  cards.filter(isActiveChecklistChild).forEach((card) => {
    const parentId = card.parent_task_id
      || atlasMetaString(card, "parent_task_id")
      || atlasMetaString(card, "parentTaskId");
    if (parentId) counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
  });
  return counts;
}

function farmTaskMove(
  farm: AtlasUniversalFarmScope,
  card: AtlasTaskCard,
  today: string,
  stepCounts: Map<string, number>,
): AtlasUniversalMove {
  const display = atlasTaskDisplay(card);
  const routeLabel = atlasRouteLabels[atlasRouteKeyForTask(card)];
  const count = stepCounts.get(card.task_id) ?? 0;
  const overdue = Boolean(card.due_date && card.due_date < today);
  const state: AtlasUniversalMoveState = card.status === "blocked"
    ? "blocked"
    : overdue
      ? "attention"
      : "ready";
  const priority = card.status === "blocked" ? 0 : overdue ? 1 : card.due_date === today ? 2 : 6;

  return {
    key: `farm-task:${farm.farmId}:${card.task_id}`,
    kind: "farm_task",
    category: overdue ? "Overdue" : display.action || routeLabel,
    title: display.title,
    scopeLabel: farm.farmName,
    meta: `${display.location} · ${count} ${count === 1 ? "step" : "steps"}`,
    detail: display.detail,
    href: `/task?taskId=${encodeURIComponent(card.task_id)}`,
    date: card.due_date,
    state,
    farmId: farm.farmId,
    projectId: null,
    priority,
  };
}

function projectTaskMove(
  task: AtlasUniversalProjectTask,
  project: AtlasPortfolioProject | undefined,
  today: string,
): AtlasUniversalMove {
  const state = projectTaskState(task, today);
  const overdue = Boolean(task.dueDate && task.dueDate < today);
  const priority = state === "blocked"
    ? 0
    : overdue
      ? 1
      : task.dueDate === today
        ? 2
        : task.dueDate
          ? 5
          : 3;
  const detail = task.blockerText
    || task.note
    || project?.currentMilestone
    || project?.outcome
    || "Open this project task.";

  return {
    key: `project-task:${task.projectId}:${task.taskId}`,
    kind: "project_task",
    category: overdue ? "Overdue" : titleCase(task.workstream || "Project work"),
    title: task.title,
    scopeLabel: task.farmName || "Feast Guild",
    meta: `${task.projectTitle}${task.dueDate ? ` · due ${task.dueDate}` : " · current work"}`,
    detail,
    href: `/project/${encodeURIComponent(task.projectId)}`,
    date: task.dueDate,
    state,
    farmId: task.farmId,
    projectId: task.projectId,
    priority,
  };
}

function projectAttentionMove(attention: AtlasPortfolioAttention, today: string): AtlasUniversalMove {
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
    state: attentionState(attention),
    farmId: null,
    projectId: attention.projectId,
    priority: attention.kind === "blocked" || overdue ? 0 : 4,
  };
}

function projectMove(project: AtlasPortfolioProject): AtlasUniversalMove {
  const state = projectState(project);
  const priority = state === "blocked" ? 1 : state === "attention" ? 4 : state === "waiting" ? 5 : 7;
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
    priority,
  };
}

function collectProjects(home: AtlasPortfolioHome | null) {
  if (!home) return [];
  const projects = new Map<string, AtlasPortfolioProject>();
  home.crossFarmProjects.forEach((project) => projects.set(project.projectId, project));
  home.farms.forEach((farm) => {
    farm.projects.forEach((project) => projects.set(project.projectId, project));
  });
  return [...projects.values()];
}

function buildMoves(
  farms: AtlasUniversalFarmScope[],
  projects: AtlasPortfolioProject[],
  projectTasks: AtlasUniversalProjectTask[],
  attention: AtlasPortfolioAttention[],
  today: string,
) {
  const candidates: AtlasUniversalMove[] = [];

  farms.forEach((farm) => {
    const cards = farm.taskCards ?? [];
    const dashboardCards = cards
      .filter(isDashboardTask)
      .sort((left, right) => atlasWorkOrderSortValue(left).localeCompare(atlasWorkOrderSortValue(right)));
    const stepCounts = subtaskCounts(cards);
    const overdue = dashboardCards
      .filter((card) => Boolean(card.due_date && card.due_date < today))
      .filter((card) => !atlasIsMowingCollectionMember(card))[0];
    if (overdue) candidates.push(farmTaskMove(farm, overdue, today, stepCounts));

    dashboardCards
      .filter((card) => card.due_date === today)
      .filter((card) => card.task_id !== overdue?.task_id)
      .filter((card) => !atlasIsMowingCollectionMember(card))
      .slice(0, 4)
      .forEach((card) => candidates.push(farmTaskMove(farm, card, today, stepCounts)));

    const mowing = atlasBuildMowingCollectionSummary(cards, today);
    if (mowing && mowing.dueCount > 0) {
      candidates.push({
        key: `collection:${farm.farmId}:${mowing.key}`,
        kind: "collection",
        category: "Collection",
        title: mowing.label,
        scopeLabel: farm.farmName,
        meta: `${mowing.dueCount} due · ${mowing.doneRecentCount} resting`,
        detail: mowing.preview,
        href: mowing.href,
        date: today,
        state: "ready",
        farmId: farm.farmId,
        projectId: null,
        priority: 2,
      });
    }
  });

  const projectsById = new Map(projects.map((project) => [project.projectId, project]));
  const activeProjectTaskIds = new Set<string>();
  projectTasks
    .filter((task) => task.status === "open" || task.status === "blocked")
    .forEach((task) => {
      activeProjectTaskIds.add(task.projectId);
      candidates.push(projectTaskMove(task, projectsById.get(task.projectId), today));
    });

  attention.forEach((item) => candidates.push(projectAttentionMove(item, today)));
  const projectsWithAttention = new Set(attention.map((item) => item.projectId));
  projects
    .filter((project) => !projectsWithAttention.has(project.projectId))
    .filter((project) => !activeProjectTaskIds.has(project.projectId))
    .forEach((project) => candidates.push(projectMove(project)));

  const seen = new Set<string>();
  return candidates
    .sort((left, right) => left.priority - right.priority
      || (left.date ?? "9999-12-31").localeCompare(right.date ?? "9999-12-31")
      || left.title.localeCompare(right.title))
    .filter((move) => {
      if (seen.has(move.key)) return false;
      seen.add(move.key);
      return true;
    })
    .slice(0, 4);
}

function buildDatedItems(
  farms: AtlasUniversalFarmScope[],
  projects: AtlasPortfolioProject[],
  projectTasks: AtlasUniversalProjectTask[],
  attention: AtlasPortfolioAttention[],
  today: string,
) {
  const items: AtlasUniversalDatedItem[] = [];

  farms.forEach((farm) => {
    farm.taskCards
      .filter(isDashboardTask)
      .filter((card) => Boolean(card.due_date))
      .forEach((card) => {
        items.push({
          key: `farm-task:${farm.farmId}:${card.task_id}:${card.due_date}`,
          kind: "farm_task",
          title: atlasTaskDisplay(card).title,
          scopeLabel: farm.farmName,
          date: card.due_date as string,
          href: `/task?taskId=${encodeURIComponent(card.task_id)}`,
          state: card.status === "blocked" ? "blocked" : "ready",
        });
      });
  });

  projectTasks.forEach((task) => {
    if (!task.dueDate) return;
    items.push({
      key: `project-task:${task.projectId}:${task.taskId}:${task.dueDate}`,
      kind: "project_task",
      title: task.title,
      scopeLabel: task.farmName || "Feast Guild",
      date: task.dueDate,
      href: `/project/${encodeURIComponent(task.projectId)}`,
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
      state: attentionState(item),
    });
  });

  const projectsWithDatedTasks = new Set(
    projectTasks.filter((task) => Boolean(task.dueDate)).map((task) => task.projectId),
  );
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

function visibleFarmMap(farms: AtlasUniversalFarmScope[], organizationHome: AtlasPortfolioHome | null) {
  const visible = new Map<string, string>();
  farms.forEach((farm) => visible.set(farm.farmId, farm.farmName));
  organizationHome?.farms.forEach((farm) => visible.set(farm.farmId, farm.farmName));
  return visible;
}

export async function readAtlasUniversalHome(
  viewer: AtlasUniversalViewer,
  options: UniversalHomeOptions = {},
): Promise<AtlasUniversalHomeModel> {
  const doneDate = options.doneDate ?? centralDateIso();
  const dueThrough = options.dueThrough ?? addDaysIso(doneDate, 35);
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("universal_home_v1", {
    p_organization_id: viewer.activeOrganizationId,
    p_preferred_farm_id: options.preferredFarmId ?? viewer.activeFarmId,
    p_due_through: dueThrough,
    p_done_date: doneDate,
  });

  if (error || !data) {
    throw new Error((error as RpcError | null)?.message || "Atlas universal home read failed.");
  }

  const raw = data as UniversalHomeRpc;
  const farms = Array.isArray(raw.farms) ? raw.farms : [];
  const organizationHome = raw.organizationHome ?? null;
  const projectTasks = Array.isArray(raw.projectTasks) ? raw.projectTasks : [];
  const activeFarmId = raw.viewer?.activeFarmId ?? options.preferredFarmId ?? viewer.activeFarmId;
  const activeFarm = farms.find((farm) => farm.farmId === activeFarmId) ?? farms[0] ?? null;
  const projects = collectProjects(organizationHome);
  const attention = organizationHome?.attention ?? [];
  const moves = buildMoves(farms, projects, projectTasks, attention, doneDate);
  const datedItems = buildDatedItems(farms, projects, projectTasks, attention, doneDate);
  const farmAttention = farms.reduce(
    (sum, farm) => sum + farm.blockedTaskCount + farm.overdueTaskCount,
    0,
  );
  const visibleFarms = visibleFarmMap(farms, organizationHome);
  const metrics: AtlasUniversalHomeMetrics = {
    farmCount: visibleFarms.size,
    projectCount: projects.length,
    openWorkCount: farms.reduce((sum, farm) => sum + farm.openTaskCount, 0)
      + projects.reduce((sum, project) => sum + project.openTaskCount, 0),
    attentionCount: farmAttention + attention.length,
    movingCount: projects.filter((project) => projectState(project) === "moving").length
      + farms.filter((farm) => farm.dueTodayCount > 0 || farm.openTaskCount > 0).length,
  };
  const singleVisibleFarmName = visibleFarms.size === 1 ? [...visibleFarms.values()][0] : null;
  const title = singleVisibleFarmName
    || (visibleFarms.size > 1 ? organizationHome?.organization.name : null)
    || activeFarm?.farmName
    || organizationHome?.organization.name
    || "Atlas";

  return {
    title,
    viewer,
    activeFarmId: activeFarm?.farmId ?? null,
    activeFarm,
    farms,
    organizationHome,
    projects,
    projectTasks,
    attention,
    moves,
    datedItems,
    metrics,
    window: {
      doneDate: raw.window?.doneDate ?? doneDate,
      dueThrough: raw.window?.dueThrough ?? dueThrough,
    },
  };
}
