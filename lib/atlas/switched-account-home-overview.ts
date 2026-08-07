import "server-only";

import { atlasDayTaskCues, atlasDayTaskFamily } from "@/lib/atlas/day-route";
import type { AtlasHomeTaskOverview } from "@/lib/atlas/home-task-overview";
import type { AtlasJournalTask } from "@/lib/atlas/journal-contract";
import type { AtlasLivingDay } from "@/lib/atlas/living-day-contract";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type {
  AtlasUniversalHomeModel,
  AtlasUniversalMove,
  AtlasUniversalMoveState,
} from "@/lib/atlas/universal-home";
import { atlasWorkOrderSortValue } from "@/lib/atlas/work-order";
import { createAtlasServerClient } from "@/lib/supabase/server";

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

function roleLabel(index: number, state: AtlasUniversalMoveState) {
  if (state === "blocked") return "Blocked";
  if (index === 0) return "Current";
  if (index === 1) return "Next";
  return "Later";
}

function cardMove(
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
  const title = clean(display.title) || card.title;
  const detail = [
    card.status === "blocked" ? card.blocker_text : null,
    display.detail,
    card.note,
  ]
    .map((value) => clean(value))
    .find((value) => value
      && value.toLowerCase() !== title.toLowerCase()
      && value.toLowerCase() !== location.toLowerCase()) ?? "";

  return {
    key: `farm-task:${farmId}:${card.task_id}`,
    kind: "farm_task",
    category: `${roleLabel(index, state)} · ${family}`,
    title,
    scopeLabel: location,
    meta: cues.join(" · "),
    detail,
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

function isOpenTask(card: AtlasTaskCard) {
  return card.status === "open" || card.status === "blocked";
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
        personalScope: true,
        farmCount: 0,
        staffLaneCount: 0,
      },
    };
  }

  const ordered = [...farm.taskCards]
    .filter(isOpenTask)
    .sort((left, right) => {
      const leftDate = left.due_date ?? "9999-12-31";
      const rightDate = right.due_date ?? "9999-12-31";
      return leftDate.localeCompare(rightDate)
        || atlasWorkOrderSortValue(left).localeCompare(atlasWorkOrderSortValue(right))
        || left.title.localeCompare(right.title);
    });
  const todayCards = ordered.filter((card) => card.due_date === today);
  const carryForwardCount = ordered.filter((card) => Boolean(card.due_date && card.due_date < today)).length;

  return {
    moves: todayCards.slice(0, 4).map((card, index) => cardMove(
      card,
      farm.farmId,
      farm.farmName,
      index,
    )),
    datedItems: home.datedItems,
    summary: {
      prepared: false,
      plannedTotal: todayCards.length,
      dealtCount: 0,
      openCount: todayCards.length,
      carryForwardCount,
      personalScope: true,
      farmCount: 1,
      staffLaneCount: 0,
    },
  };
}

function overviewFromLivingDay(
  home: AtlasUniversalHomeModel,
  livingDay: AtlasLivingDay,
): AtlasHomeTaskOverview {
  const farm = home.activeFarm;
  if (!farm) return fallbackOverview(home);

  const cardsById = new Map(
    farm.taskCards
      .filter(isOpenTask)
      .map((card) => [card.task_id, card]),
  );
  const preparedOpen = livingDay.journal.planned.filter(
    (task) => task.status === "open" || task.status === "blocked",
  );
  const moves = preparedOpen
    .slice(0, 4)
    .map((task, index) => {
      const card = cardsById.get(task.taskId);
      return card
        ? cardMove(card, farm.farmId, farm.farmName, index)
        : taskRefMove(task, farm.farmId, farm.farmName, index);
    });
  const completion = livingDay.completionSummary;
  const plannedTotal = Math.max(
    completion.plannedOpen + completion.plannedDone,
    livingDay.journal.planned.length,
  );
  const carryForwardCount = livingDay.journal.carried.filter(
    (task) => task.status !== "done" && task.status !== "archived",
  ).length;

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

export async function readAtlasSwitchedFarmHandHomeOverview(
  home: AtlasUniversalHomeModel,
  effectiveMembershipId: string,
): Promise<AtlasHomeTaskOverview> {
  if (!home.activeFarm?.farmId) return fallbackOverview(home);

  // Owner preview is read-only. It must never materialize work into the worker's real day.
  try {
    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("owner_operator_home_day_v1", {
      p_effective_membership_id: effectiveMembershipId,
      p_day: home.window.doneDate,
    });
    if (error || !data) throw error ?? new Error("Selected member Living Day was empty.");
    return overviewFromLivingDay(home, data as AtlasLivingDay);
  } catch {
    return fallbackOverview(home);
  }
}
