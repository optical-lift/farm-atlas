import "server-only";

import { atlasDayTaskCues, atlasDayTaskFamily } from "@/lib/atlas/day-route";
import type { AtlasLivingDay, AtlasLivingDayTaskRef } from "@/lib/atlas/living-day-contract";
import {
  atlasMetadataValue,
  atlasMetaString,
  atlasTaskDisplay,
} from "@/lib/atlas/task-display";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type {
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
};

export type AtlasHomeTaskOverview = {
  moves: AtlasUniversalMove[];
  summary: AtlasHomeDayOverview;
};

type LivingDayRpcError = { message?: string };

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

function isOpenTask(card: AtlasTaskCard) {
  const checklistStatus = (atlasMetaString(card, "checklist_status") ?? "").toLowerCase();
  return (card.status === "open" || card.status === "blocked")
    && checklistStatus !== "done"
    && !isChildTask(card)
    && !isQuietTask(card);
}

function isOpenTaskRef(task: AtlasLivingDayTaskRef) {
  return task.status === "open" || task.status === "blocked";
}

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
): AtlasUniversalMove {
  const display = atlasTaskDisplay(card);
  const family = atlasDayTaskFamily(card);
  const cues = atlasDayTaskCues(card);
  const location = clean(display.location) || farmName;
  const state: AtlasUniversalMoveState = card.status === "blocked" ? "blocked" : "ready";

  return {
    key: `farm-task:${farmId}:${card.task_id}`,
    kind: "farm_task",
    category: `${roleLabel(index, state)} · ${family}`,
    title: clean(display.title) || card.title,
    scopeLabel: location,
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
  task: AtlasLivingDayTaskRef,
  farmId: string,
  farmName: string,
  index: number,
): AtlasUniversalMove {
  const state: AtlasUniversalMoveState = task.status === "blocked" ? "blocked" : "ready";
  const family = titleCase(task.actionKey || task.taskType || task.workClass || "Work");
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
    detail: clean(task.blockerText),
    href: `/task-focus/${encodeURIComponent(task.taskId)}?returnTo=${encodeURIComponent("/")}`,
    date: task.dueDate,
    state,
    farmId,
    projectId: null,
    priority: index,
  };
}

function orderedCards(cards: AtlasTaskCard[]) {
  return [...cards].sort((left, right) => atlasWorkOrderSortValue(left).localeCompare(atlasWorkOrderSortValue(right)));
}

function fallbackOverview(home: AtlasUniversalHomeModel): AtlasHomeTaskOverview {
  const farm = home.activeFarm;
  const today = home.window.doneDate;
  if (!farm) {
    return {
      moves: [],
      summary: { prepared: false, plannedTotal: 0, dealtCount: 0, openCount: 0, carryForwardCount: 0 },
    };
  }

  const todayCards = orderedCards(farm.taskCards.filter((card) => isOpenTask(card) && card.due_date === today));
  const carryForwardCount = farm.taskCards.filter((card) => isOpenTask(card) && Boolean(card.due_date && card.due_date < today)).length;
  return {
    moves: todayCards.slice(0, 4).map((card, index) => taskMove(card, farm.farmId, farm.farmName, index)),
    summary: {
      prepared: false,
      plannedTotal: todayCards.length,
      dealtCount: 0,
      openCount: todayCards.length,
      carryForwardCount,
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
    summary: {
      prepared: true,
      plannedTotal,
      dealtCount: completion.plannedDone,
      openCount: completion.plannedOpen,
      carryForwardCount,
    },
  };
}

export async function readAtlasOperatorHomeTaskOverview(
  home: AtlasUniversalHomeModel,
): Promise<AtlasHomeTaskOverview> {
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
