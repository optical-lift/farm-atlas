import "server-only";

import type { AtlasSessionMembership } from "@/lib/atlas/session";
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
} from "@/lib/atlas/universal-home";
import type { AtlasUniversalViewer } from "@/lib/atlas/viewer";
import { atlasWorkOrderSortValue } from "@/lib/atlas/work-order";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasOperatorUniversalHomeOptions = {
  preferredFarmId?: string | null;
  doneDate?: string;
  dueThrough?: string;
  effectiveMembershipId?: string | null;
};

type OperatorContextRow = {
  isOperating?: boolean;
  effective?: {
    userId?: string;
    membershipId?: string;
    role?: "owner" | "manager" | "farm_hand";
    workerKey?: string | null;
    displayName?: string;
    permissions?: Record<string, unknown>;
  };
};

type OperatorHomeRpc = {
  farms?: AtlasUniversalFarmScope[];
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

function buildMoves(farm: AtlasUniversalFarmScope, today: string) {
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

function buildDatedItems(farm: AtlasUniversalFarmScope): AtlasUniversalDatedItem[] {
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

function effectiveViewer(
  actor: AtlasUniversalViewer,
  farm: AtlasUniversalFarmScope,
  context: OperatorContextRow,
): AtlasUniversalViewer {
  const effective = context.effective;
  const role = effective?.role ?? "farm_hand";
  const membership: AtlasSessionMembership = {
    membershipId: effective?.membershipId ?? farm.membershipId,
    farmId: farm.farmId,
    farmKey: farm.farmKey,
    farmName: farm.farmName,
    farmStatus: farm.farmStatus,
    role,
    workerKey: effective?.workerKey ?? farm.workerKey,
    permissions: effective?.permissions ?? farm.permissions,
  };

  return {
    userId: actor.userId,
    email: actor.email,
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

export async function readAtlasOperatorUniversalHome(
  viewer: AtlasUniversalViewer,
  options: AtlasOperatorUniversalHomeOptions = {},
): Promise<AtlasUniversalHomeModel> {
  const effectiveMembershipId = options.effectiveMembershipId?.trim() || null;
  if (!effectiveMembershipId) {
    return readAtlasUniversalHome(viewer, options);
  }

  const doneDate = options.doneDate ?? centralDateIso();
  const dueThrough = options.dueThrough ?? addDaysIso(doneDate, 35);
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_operator_universal_home_v1", {
    p_effective_membership_id: effectiveMembershipId,
    p_organization_id: viewer.activeOrganizationId,
    p_preferred_farm_id: options.preferredFarmId ?? viewer.activeFarmId,
    p_due_through: dueThrough,
    p_done_date: doneDate,
  });

  if (error || !data) {
    throw new Error((error as RpcError | null)?.message || "Atlas owner operator home read failed.");
  }

  const raw = data as OperatorHomeRpc;
  const farm = Array.isArray(raw.farms) ? raw.farms[0] ?? null : null;
  const context = raw.operatorContext ?? {};
  if (!farm || !context.isOperating) {
    return readAtlasUniversalHome(viewer, options);
  }

  const moves = buildMoves(farm, doneDate);
  const datedItems = buildDatedItems(farm);
  const attentionCount = farm.blockedTaskCount + farm.overdueTaskCount;

  return {
    title: farm.farmName,
    viewer: effectiveViewer(viewer, farm, context),
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
      attentionCount,
      movingCount: farm.dueTodayCount > 0 || farm.openTaskCount > 0 ? 1 : 0,
    },
    window: {
      doneDate: raw.window?.doneDate ?? doneDate,
      dueThrough: raw.window?.dueThrough ?? dueThrough,
    },
  };
}
