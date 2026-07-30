import "server-only";

import { atlasDayTaskCues, atlasDayTaskFamily } from "@/lib/atlas/day-route";
import type { AtlasJournalTask } from "@/lib/atlas/journal-contract";
import type { AtlasLivingDay } from "@/lib/atlas/living-day-contract";
import {
  atlasMetadataValue,
  atlasMetaString,
  atlasTaskDisplay,
} from "@/lib/atlas/task-display";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type {
  AtlasUniversalDatedItem,
  AtlasUniversalFarmScope,
  AtlasUniversalHomeModel,
  AtlasUniversalMove,
  AtlasUniversalMoveState,
} from "@/lib/atlas/universal-home";
import { atlasWorkOrderSortValue } from "@/lib/atlas/work-order";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasHomeDayOverview = {
  prepared: boolean;
  plannedTotal: number;
  dealtCount: number;
  openCount: number;
  carryForwardCount: number;
  personalScope: boolean;
  farmCount: number;
  staffLaneCount: number;
};

export type AtlasHomeTaskOverview = {
  moves: AtlasUniversalMove[];
  datedItems: AtlasUniversalDatedItem[];
  summary: AtlasHomeDayOverview;
};

type LivingDayRpcError = { message?: string };
type AssignedTaskCard = AtlasTaskCard & {
  assigned_membership_id?: string | null;
  assigned_user_id?: string | null;
};

type FarmTaskRef = {
  farm: AtlasUniversalFarmScope;
  card: AssignedTaskCard;
};

type StaffTaskGroup = {
  farm: AtlasUniversalFarmScope;
  workerKey: string;
  workerLabel: string;
  cards: AssignedTaskCard[];
};

function isChildTask(card: AtlasTaskCard) {
  return Boolean(card.parent_task_id)
    || atlasMetadataValue(card, "is_child_task") === true
    || atlasMetadataValue(card, "is_child_task") === "true";
}

function isQuietTask(card: AtlasTaskCard) {
  const value = atlasMetadataValue(card, "hide_from_home_hero")
    ?? atlasMetadataValue(card, "quiet_task");
  return value === true || value === "true" || value === "yes" || value === 1;
}

function isDisplayTask(card: AtlasTaskCard) {
  const checklistStatus = (atlasMetaString(card, "checklist_status") ?? "").toLowerCase();
  return card.status !== "archived"
    && checklistStatus !== "archived"
    && !isChildTask(card)
    && !isQuietTask(card);
}

function isOpenTask(card: AtlasTaskCard) {
  return isDisplayTask(card) && (card.status === "open" || card.status === "blocked");
}

function isDoneTask(card: AtlasTaskCard) {
  return isDisplayTask(card) && card.status === "done";
}

function isOpenTaskRef(task: AtlasJournalTask) {
  return task.status === "open" || task.status === "blocked";
}

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalized(value: string | null | undefined) {
  return clean(value).toLowerCase().replaceAll(" ", "_");
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metadataStrings(card: AtlasTaskCard, key: string) {
  const value = atlasMetadataValue(card, key);
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function usefulDetail(card: AtlasTaskCard, title: string, location: string) {
  const display = atlasTaskDisplay(card);
  const candidates = [
    card.status === "blocked" ? card.blocker_text : null,
    display.detail,
    card.note,
  ];
  return candidates
    .map((value) => clean(value))
    .find((value) => value
      && value.toLowerCase() !== title.toLowerCase()
      && value.toLowerCase() !== location.toLowerCase()) ?? "";
}

function roleLabel(index: number, state: AtlasUniversalMoveState) {
  if (state === "blocked") return "Blocked";
  if (index === 0) return "Current";
  if (index === 1) return "Next";
  return "Later";
}

function taskMove(
  card: AtlasTaskCard,
  farmId: string,
  farmName: string,
  index: number,
  multiFarm = false,
): AtlasUniversalMove {
  const display = atlasTaskDisplay(card);
  const family = atlasDayTaskFamily(card);
  const cues = atlasDayTaskCues(card);
  const location = clean(display.location) || farmName;
  const scopeLabel = multiFarm && normalized(location) !== normalized(farmName)
    ? `${farmName} · ${location}`
    : location;
  const state: AtlasUniversalMoveState = card.status === "blocked" ? "blocked" : "ready";

  return {
    key: `farm-task:${farmId}:${card.task_id}`,
    kind: "farm_task",
    category: `${roleLabel(index, state)} · ${family}`,
    title: clean(display.title) || card.title,
    scopeLabel,
    meta: cues.join(" · "),
    detail: usefulDetail(card, clean(display.title) || card.title, location),
    href: `/task-focus/${encodeURIComponent(card.task_id)}?returnTo=${encodeURIComponent("/")}`,
    date: card.due_date,
    state,
    farmId,
    projectId: null,
    priority: index,
  };
}

function taskRefMove(
  task: AtlasJournalTask,
  farmId: string,
  farmName: string,
  index: number,
): AtlasUniversalMove {
  const state: AtlasUniversalMoveState = task.status === "blocked" ? "blocked" : "ready";
  const family = titleCase(task.taskType || task.workClass || "Work");
  const effort = clean(task.workClass);
  const priority = clean(task.priority);
  const cue = effort && !["standard", "required", "manual"].includes(effort.toLowerCase())
    ? titleCase(effort)
    : priority && !["normal", "medium"].includes(priority.toLowerCase())
      ? titleCase(priority)
      : "";

  return {
    key: `farm-task:${farmId}:${task.taskId}`,
    kind: "farm_task",
    category: `${roleLabel(index, state)} · ${family}`,
    title: task.title,
    scopeLabel: farmName,
    meta: cue,
    detail: "",
    href: `/task-focus/${encodeURIComponent(task.taskId)}?returnTo=${encodeURIComponent("/")}`,
    date: task.dueDate,
    state,
    farmId,
    projectId: null,
    priority: index,
  };
}

function orderedCards(cards: AtlasTaskCard[]) {
  return [...cards].sort((left, right) => {
    const leftDate = left.due_date ?? "9999-12-31";
    const rightDate = right.due_date ?? "9999-12-31";
    return leftDate.localeCompare(rightDate)
      || atlasWorkOrderSortValue(left).localeCompare(atlasWorkOrderSortValue(right))
      || left.title.localeCompare(right.title);
  });
}

function personalAssignmentContext(home: AtlasUniversalHomeModel) {
  const membershipIds = new Set<string>();
  const workerKeys = new Set<string>();

  home.viewer.farmMemberships.forEach((membership) => {
    membershipIds.add(membership.membershipId);
    if (membership.workerKey) workerKeys.add(normalized(membership.workerKey));
    if (membership.role === "owner") workerKeys.add("owner");
  });

  return { membershipIds, workerKeys };
}

function isPersonalTask(
  card: AssignedTaskCard,
  membershipIds: Set<string>,
  workerKeys: Set<string>,
) {
  if (card.assigned_membership_id && membershipIds.has(card.assigned_membership_id)) return true;
  if (metadataStrings(card, "shared_with_membership_ids").some((id) => membershipIds.has(id))) return true;
  if (metadataStrings(card, "shared_with_worker_keys").some((key) => workerKeys.has(normalized(key)))) return true;

  const assignee = normalized(
    atlasMetaString(card, "assignee_key")
      || atlasMetaString(card, "assigned_to")
      || atlasMetaString(card, "work_route"),
  );
  return Boolean(assignee && workerKeys.has(assignee));
}

function personalTaskRefs(home: AtlasUniversalHomeModel) {
  const context = personalAssignmentContext(home);
  const seen = new Set<string>();
  const refs: FarmTaskRef[] = [];

  home.farms.forEach((farm) => {
    farm.taskCards.forEach((rawCard) => {
      const card = rawCard as AssignedTaskCard;
      if (!isDisplayTask(card) || !isPersonalTask(card, context.membershipIds, context.workerKeys)) return;
      if (seen.has(card.task_id)) return;
      seen.add(card.task_id);
      refs.push({ farm, card });
    });
  });

  return refs;
}

function staffIdentity(card: AssignedTaskCard) {
  const key = normalized(
    atlasMetaString(card, "assignee_key")
      || atlasMetaString(card, "assigned_to"),
  );
  if (!key || ["owner", "lex", "kids", "children", "farm_team", "team"].includes(key)) return null;
  const label = clean(atlasMetaString(card, "assigned_to")) || titleCase(key);
  return { key, label };
}

function staffSummaryMoves(
  home: AtlasUniversalHomeModel,
  today: string,
  personalIds: Set<string>,
): AtlasUniversalMove[] {
  const groups = new Map<string, StaffTaskGroup>();

  home.farms.forEach((farm) => {
    farm.taskCards.forEach((rawCard) => {
      const card = rawCard as AssignedTaskCard;
      if (!isOpenTask(card) || !card.due_date || card.due_date > today) return;
      if (card.assigned_membership_id && personalIds.has(card.assigned_membership_id)) return;
      if (atlasMetadataValue(card, "owner_task") === true) return;
      const identity = staffIdentity(card);
      if (!identity) return;
      const groupKey = `${farm.farmId}:${card.assigned_membership_id ?? identity.key}`;
      const existing = groups.get(groupKey) ?? {
        farm,
        workerKey: identity.key,
        workerLabel: identity.label,
        cards: [],
      };
      existing.cards.push(card);
      groups.set(groupKey, existing);
    });
  });

  return [...groups.values()]
    .map((group): AtlasUniversalMove | null => {
      const overdue = orderedCards(group.cards.filter((card) => Boolean(card.due_date && card.due_date < today)));
      const dueToday = orderedCards(group.cards.filter((card) => card.due_date === today));
      const first = overdue[0] ?? dueToday[0];
      if (!first) return null;
      const overdueCount = overdue.length;
      const todayCount = dueToday.length;
      const title = overdueCount > 0
        ? `${group.workerLabel} has ${overdueCount} ${overdueCount === 1 ? "task" : "tasks"} overdue`
        : `${group.workerLabel} has ${todayCount} due today`;
      const summary = [
        overdueCount > 0 ? `${overdueCount} overdue` : null,
        todayCount > 0 ? `${todayCount} due today` : null,
      ].filter(Boolean).join(" · ");
      return {
        key: `collection:staff-overview:${group.farm.farmId}:${group.workerKey}`,
        kind: "collection",
        category: `${group.farm.farmName} · Staff`,
        title,
        scopeLabel: summary,
        meta: "",
        detail: `First: ${atlasTaskDisplay(first).title}`,
        href: `/day?date=${encodeURIComponent(today)}&view=work_order`,
        date: first.due_date,
        state: overdueCount > 0 ? "attention" : "ready",
        farmId: group.farm.farmId,
        projectId: null,
        priority: overdueCount > 0 ? 90 : 100,
      };
    })
    .filter((move): move is AtlasUniversalMove => Boolean(move))
    .sort((left, right) => left.priority - right.priority || left.title.localeCompare(right.title));
}

function personalDatedItems(refs: FarmTaskRef[]): AtlasUniversalDatedItem[] {
  return refs
    .filter(({ card }) => Boolean(card.due_date))
    .map(({ farm, card }) => ({
      key: `farm-task:${farm.farmId}:${card.task_id}:${card.due_date}`,
      kind: "farm_task" as const,
      title: atlasTaskDisplay(card).title,
      scopeLabel: farm.farmName,
      date: card.due_date as string,
      href: `/task-focus/${encodeURIComponent(card.task_id)}`,
      state: card.status === "done"
        ? "complete" as const
        : card.status === "blocked"
          ? "blocked" as const
          : "ready" as const,
    }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
}

function oversightOverview(home: AtlasUniversalHomeModel): AtlasHomeTaskOverview {
  const today = home.window.doneDate;
  const refs = personalTaskRefs(home);
  const context = personalAssignmentContext(home);
  const openTodayRefs = refs.filter(({ card }) => isOpenTask(card) && card.due_date === today);
  const doneTodayRefs = refs.filter(({ card }) => isDoneTask(card) && card.due_date === today);
  const carryForwardCount = refs.filter(({ card }) => isOpenTask(card) && Boolean(card.due_date && card.due_date < today)).length;
  const sortedToday = [...openTodayRefs].sort((left, right) => {
    return atlasWorkOrderSortValue(left.card).localeCompare(atlasWorkOrderSortValue(right.card))
      || left.farm.farmName.localeCompare(right.farm.farmName)
      || left.card.title.localeCompare(right.card.title);
  });
  const personalMoves = sortedToday.map(({ farm, card }, index) => taskMove(
    card,
    farm.farmId,
    farm.farmName,
    index,
    home.farms.length > 1,
  ));
  const staffMoves = staffSummaryMoves(home, today, context.membershipIds);
  const personalLimit = staffMoves.length > 0 && personalMoves.length > 3 ? 3 : 4;
  const moves = [...personalMoves.slice(0, personalLimit), ...staffMoves]
    .slice(0, 4);

  return {
    moves,
    datedItems: personalDatedItems(refs),
    summary: {
      prepared: false,
      plannedTotal: openTodayRefs.length + doneTodayRefs.length,
      dealtCount: doneTodayRefs.length,
      openCount: openTodayRefs.length,
      carryForwardCount,
      personalScope: true,
      farmCount: home.farms.length,
      staffLaneCount: staffMoves.length,
    },
  };
}

function fallbackOverview(home: AtlasUniversalHomeModel): AtlasHomeTaskOverview {
  const farm = home.activeFarm;
  const today = home.window.doneDate;
  if (!farm) {
    return {
      moves: [],
      datedItems: [],
      summary: {
        prepared: false,
        plannedTotal: 0,
        dealtCount: 0,
        openCount: 0,
        carryForwardCount: 0,
        personalScope: false,
        farmCount: home.farms.length,
        staffLaneCount: 0,
      },
    };
  }

  const todayCards = orderedCards(farm.taskCards.filter((card) => isOpenTask(card) && card.due_date === today));
  const carryForwardCount = farm.taskCards.filter((card) => isOpenTask(card) && Boolean(card.due_date && card.due_date < today)).length;
  return {
    moves: todayCards.slice(0, 4).map((card, index) => taskMove(card, farm.farmId, farm.farmName, index)),
    datedItems: home.datedItems,
    summary: {
      prepared: false,
      plannedTotal: todayCards.length,
      dealtCount: 0,
      openCount: todayCards.length,
      carryForwardCount,
      personalScope: false,
      farmCount: 1,
      staffLaneCount: 0,
    },
  };
}

function overviewFromLivingDay(home: AtlasUniversalHomeModel, livingDay: AtlasLivingDay): AtlasHomeTaskOverview {
  const farm = home.activeFarm;
  if (!farm) return fallbackOverview(home);

  const cardsById = new Map(
    farm.taskCards
      .filter(isOpenTask)
      .map((card) => [card.task_id, card]),
  );
  const preparedOpen = livingDay.journal.planned.filter(isOpenTaskRef);
  const moves = preparedOpen
    .slice(0, 4)
    .map((task, index) => {
      const card = cardsById.get(task.taskId);
      return card
        ? taskMove(card, farm.farmId, farm.farmName, index)
        : taskRefMove(task, farm.farmId, farm.farmName, index);
    });
  const completion = livingDay.completionSummary;
  const plannedTotal = Math.max(
    completion.plannedOpen + completion.plannedDone,
    livingDay.journal.planned.length,
  );
  const carryForwardCount = livingDay.journal.carried.filter((task) => task.status !== "done" && task.status !== "archived").length;

  return {
    moves,
    datedItems: home.datedItems,
    summary: {
      prepared: true,
      plannedTotal,
      dealtCount: completion.plannedDone,
      openCount: completion.plannedOpen,
      carryForwardCount,
      personalScope: false,
      farmCount: 1,
      staffLaneCount: 0,
    },
  };
}

export async function readAtlasOperatorHomeTaskOverview(
  home: AtlasUniversalHomeModel,
): Promise<AtlasHomeTaskOverview> {
  if (home.viewer.canManageAnyFarm || home.viewer.canManageAnyPortfolio) {
    return oversightOverview(home);
  }
  if (!home.activeFarm?.farmId) return fallbackOverview(home);

  try {
    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("living_day_v1", {
      p_farm_id: home.activeFarm.farmId,
      p_day: home.window.doneDate,
    });
    if (error) throw error as LivingDayRpcError;
    return overviewFromLivingDay(home, data as AtlasLivingDay);
  } catch {
    return fallbackOverview(home);
  }
}
