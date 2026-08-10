import "server-only";

import type {
  AtlasPortfolioHome,
  AtlasPortfolioProject,
} from "@/lib/atlas/portfolio";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasProjectsHomeBlocker = {
  taskId: string;
  title: string;
  dueDate: string | null;
  unlockText: string | null;
  projectId: string;
  projectTitle: string;
  farmId: string | null;
  farmName: string | null;
  targetDate: string | null;
  rootProjectIds: string[];
  downstreamUnlockCount: number;
  blockedMembershipCount: number;
  rankingReasons: string[];
  score: number;
};

export type AtlasProjectsHomePriority = {
  primaryBlocker: AtlasProjectsHomeBlocker | null;
  secondaryBlockers: AtlasProjectsHomeBlocker[];
  secondaryCount: number;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  assigned_user_id: string | null;
  assigned_membership_id: string | null;
  visibility_scope: string | null;
  metadata: Record<string, unknown> | null;
};

type ProjectTaskLinkRow = { project_id: string; task_id: string };
type DependencyRow = { prerequisite_task_id: string; downstream_task_id: string };
type MembershipRow = { id: string; role: string; user_id: string | null };

type RankInput = {
  home: AtlasPortfolioHome;
  ownerUserId: string;
  today: string;
  links: ProjectTaskLinkRow[];
  tasks: TaskRow[];
  dependencies: DependencyRow[];
  memberships: MembershipRow[];
};

function boolMeta(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key];
  return value === true || value === "true" || value === "yes" || value === 1 || value === "1";
}

function dateDistance(fromIso: string, toIso: string) {
  const from = new Date(`${fromIso}T12:00:00Z`).getTime();
  const to = new Date(`${toIso}T12:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

function atlasOperatingDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function activeVisibleProjects(home: AtlasPortfolioHome) {
  return [...home.crossFarmProjects, ...home.farms.flatMap((farm) => farm.projects)]
    .filter((project) => project.status !== "paused" && project.status !== "archived" && project.portfolioType !== "incubator");
}

function projectDepth(project: AtlasPortfolioProject, byId: Map<string, AtlasPortfolioProject>) {
  let depth = 0;
  let current: AtlasPortfolioProject | undefined = project;
  const seen = new Set<string>();
  while (current?.parentProjectId && !seen.has(current.projectId)) {
    seen.add(current.projectId);
    const parent = byId.get(current.parentProjectId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

function rootProjectId(project: AtlasPortfolioProject, byId: Map<string, AtlasPortfolioProject>) {
  let current = project;
  const seen = new Set<string>();
  while (current.parentProjectId && !seen.has(current.projectId)) {
    seen.add(current.projectId);
    const parent = byId.get(current.parentProjectId);
    if (!parent) break;
    current = parent;
  }
  return current.projectId;
}

function preferredProject(projects: AtlasPortfolioProject[], byId: Map<string, AtlasPortfolioProject>) {
  const typeRank: Record<string, number> = { event: 0, side_quest: 1, campaign: 2, program: 3 };
  return [...projects].sort((left, right) =>
    (right.targetDate ? 1 : 0) - (left.targetDate ? 1 : 0)
    || projectDepth(right, byId) - projectDepth(left, byId)
    || (typeRank[left.portfolioType] ?? 9) - (typeRank[right.portfolioType] ?? 9)
    || (left.targetDate ?? "9999-12-31").localeCompare(right.targetDate ?? "9999-12-31")
    || left.title.localeCompare(right.title))[0];
}

function priorityWeight(priority: string | null) {
  if (priority === "urgent") return 42;
  if (priority === "high") return 25;
  if (priority === "low") return -4;
  return 0;
}

export function rankAtlasProjectsHomePriority(input: RankInput): AtlasProjectsHomePriority {
  const projects = activeVisibleProjects(input.home);
  const projectById = new Map(projects.map((project) => [project.projectId, project]));
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const membershipById = new Map(input.memberships.map((membership) => [membership.id, membership]));
  const projectIdsByTask = new Map<string, Set<string>>();
  for (const link of input.links) {
    if (!projectById.has(link.project_id)) continue;
    const projectIds = projectIdsByTask.get(link.task_id) ?? new Set<string>();
    projectIds.add(link.project_id);
    projectIdsByTask.set(link.task_id, projectIds);
  }

  const downstreamByPrerequisite = new Map<string, Set<string>>();
  for (const dependency of input.dependencies) {
    const downstream = downstreamByPrerequisite.get(dependency.prerequisite_task_id) ?? new Set<string>();
    downstream.add(dependency.downstream_task_id);
    downstreamByPrerequisite.set(dependency.prerequisite_task_id, downstream);
  }

  const candidates: AtlasProjectsHomeBlocker[] = [];
  for (const task of input.tasks) {
    if (task.status !== "open") continue;
    const linkedProjectIds = [...(projectIdsByTask.get(task.id) ?? [])];
    const linkedProjects = linkedProjectIds.map((projectId) => projectById.get(projectId)).filter((project): project is AtlasPortfolioProject => Boolean(project));
    if (!linkedProjects.length) continue;

    const assignedMembership = task.assigned_membership_id ? membershipById.get(task.assigned_membership_id) : null;
    const ownerActionable = task.assigned_user_id === input.ownerUserId
      || assignedMembership?.role === "owner"
      || task.visibility_scope === "owner"
      || boolMeta(task.metadata, "owner_task")
      || boolMeta(task.metadata, "owner_decision_required")
      || boolMeta(task.metadata, "delegation_task");
    if (!ownerActionable) continue;

    const downstreamIds = [...(downstreamByPrerequisite.get(task.id) ?? [])]
      .filter((taskId) => {
        const downstream = taskById.get(taskId);
        return downstream ? downstream.status === "open" || downstream.status === "blocked" : true;
      });
    const downstreamUnlockCount = downstreamIds.length;
    const blockedPeople = new Set<string>();
    for (const downstreamId of downstreamIds) {
      const downstream = taskById.get(downstreamId);
      if (!downstream) continue;
      if (downstream.assigned_membership_id && downstream.assigned_membership_id !== task.assigned_membership_id) {
        blockedPeople.add(`membership:${downstream.assigned_membership_id}`);
      } else if (downstream.assigned_user_id && downstream.assigned_user_id !== input.ownerUserId) {
        blockedPeople.add(`user:${downstream.assigned_user_id}`);
      }
    }
    const blockedMembershipCount = blockedPeople.size;
    const project = preferredProject(linkedProjects, projectById);
    if (!project) continue;
    const targetDates = linkedProjects.map((item) => item.targetDate).filter((date): date is string => Boolean(date));
    const targetDate = targetDates.sort()[0] ?? null;
    const daysToTarget = targetDate ? dateDistance(input.today, targetDate) : null;
    const daysToDue = task.due_date ? dateDistance(input.today, task.due_date) : null;
    const ownerDecision = boolMeta(task.metadata, "owner_decision_required") || boolMeta(task.metadata, "delegation_task");
    const hardDate = targetDate !== null || task.metadata?.commitment_kind === "hard_date" || typeof task.metadata?.event_deadline === "string";

    // Projects home is consequence-first: the Move must either unlock work, represent an Owner decision,
    // or be high-priority work against a near hard date. Ordinary overdue Owner chores never become the hero.
    if (!(downstreamUnlockCount > 0 || ownerDecision || (task.priority === "high" && hardDate && daysToTarget !== null && daysToTarget <= 7))) continue;

    let score = priorityWeight(task.priority);
    score += downstreamUnlockCount * 18;
    score += blockedMembershipCount * 22;
    if (hardDate && daysToTarget !== null && daysToTarget <= 7) score += 30 + Math.max(0, 7 - daysToTarget) * 3;
    if (daysToDue !== null) {
      if (daysToDue <= 0) score += 26;
      else if (daysToDue === 1) score += 18;
      else if (daysToDue <= 3) score += 10;
    }
    if (ownerDecision) score += 20;

    const rankingReasons: string[] = [];
    if (downstreamUnlockCount) rankingReasons.push(`${downstreamUnlockCount} downstream ${downstreamUnlockCount === 1 ? "move" : "moves"}`);
    if (blockedMembershipCount) rankingReasons.push(`${blockedMembershipCount} ${blockedMembershipCount === 1 ? "teammate" : "teammates"} waiting`);
    if (hardDate && targetDate) rankingReasons.push(`hard date ${targetDate}`);
    if (ownerDecision) rankingReasons.push("Owner decision");

    const rootProjectIds = [...new Set(linkedProjects.map((linkedProject) => rootProjectId(linkedProject, projectById)))];
    candidates.push({
      taskId: task.id,
      title: task.title,
      dueDate: task.due_date,
      unlockText: task.unlock_text,
      projectId: project.projectId,
      projectTitle: project.title,
      farmId: project.farmId,
      farmName: project.farmName,
      targetDate,
      rootProjectIds,
      downstreamUnlockCount,
      blockedMembershipCount,
      rankingReasons,
      score,
    });
  }

  const ranked = candidates.sort((left, right) =>
    right.score - left.score
    || (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31")
    || left.title.localeCompare(right.title));

  return {
    primaryBlocker: ranked[0] ?? null,
    secondaryBlockers: ranked.slice(1, 5),
    secondaryCount: Math.max(0, ranked.length - 1),
  };
}

export async function readAtlasProjectsHomePriority(
  home: AtlasPortfolioHome,
  ownerUserId: string,
): Promise<AtlasProjectsHomePriority> {
  const projects = activeVisibleProjects(home);
  const projectIds = projects.map((project) => project.projectId);
  if (!projectIds.length) return { primaryBlocker: null, secondaryBlockers: [], secondaryCount: 0 };

  const supabase = await createAtlasServerClient();
  const { data: linkData, error: linkError } = await supabase
    .schema("atlas")
    .from("project_task_links")
    .select("project_id,task_id")
    .in("project_id", projectIds);
  if (linkError) throw new Error(linkError.message);

  const links = (linkData ?? []) as ProjectTaskLinkRow[];
  const linkedTaskIds = [...new Set(links.map((link) => link.task_id))];
  if (!linkedTaskIds.length) return { primaryBlocker: null, secondaryBlockers: [], secondaryCount: 0 };

  const { data: dependencyData, error: dependencyError } = await supabase
    .schema("atlas")
    .from("task_prerequisites")
    .select("prerequisite_task_id,downstream_task_id")
    .in("prerequisite_task_id", linkedTaskIds)
    .eq("active", true)
    .is("satisfied_at", null);
  if (dependencyError) throw new Error(dependencyError.message);

  const dependencies = (dependencyData ?? []) as DependencyRow[];
  const downstreamIds = dependencies.map((dependency) => dependency.downstream_task_id);
  const taskIds = [...new Set([...linkedTaskIds, ...downstreamIds])];
  const { data: taskData, error: taskError } = await supabase
    .schema("atlas")
    .from("tasks")
    .select("id,title,status,priority,due_date,unlock_text,blocker_text,assigned_user_id,assigned_membership_id,visibility_scope,metadata")
    .in("id", taskIds)
    .in("status", ["open", "blocked"]);
  if (taskError) throw new Error(taskError.message);

  const tasks = (taskData ?? []) as TaskRow[];
  const membershipIds = [...new Set(tasks.map((task) => task.assigned_membership_id).filter((id): id is string => Boolean(id)))];
  let memberships: MembershipRow[] = [];
  if (membershipIds.length) {
    const { data: membershipData, error: membershipError } = await supabase
      .schema("atlas")
      .from("farm_memberships")
      .select("id,role,user_id")
      .in("id", membershipIds);
    if (membershipError) throw new Error(membershipError.message);
    memberships = (membershipData ?? []) as MembershipRow[];
  }

  return rankAtlasProjectsHomePriority({
    home,
    ownerUserId,
    today: atlasOperatingDate(),
    links,
    tasks,
    dependencies,
    memberships,
  });
}
