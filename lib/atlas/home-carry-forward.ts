import "server-only";

import { atlasDayTaskCues, atlasDayTaskFamily } from "@/lib/atlas/day-route";
import type { AtlasHomeTaskOverview } from "@/lib/atlas/home-task-overview";
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

type FarmTaskRef = {
  farm: AtlasUniversalFarmScope;
  card: AtlasTaskCard;
};

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalized(value: string | null | undefined) {
  return clean(value).toLowerCase().replaceAll(" ", "_");
}

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

function isOpenDisplayTask(card: AtlasTaskCard) {
  const checklistStatus = (atlasMetaString(card, "checklist_status") ?? "").toLowerCase();
  return (card.status === "open" || card.status === "blocked")
    && checklistStatus !== "archived"
    && !isChildTask(card)
    && !isQuietTask(card);
}

function isOpenDatedItem(item: AtlasUniversalDatedItem) {
  return item.state !== "complete";
}

function taskIdFromDatedItem(item: AtlasUniversalDatedItem) {
  const focusMatch = item.href.match(/\/task-focus\/([^/?#]+)/);
  if (focusMatch?.[1]) {
    try {
      return decodeURIComponent(focusMatch[1]);
    } catch {
      return focusMatch[1];
    }
  }

  if (item.key.startsWith("farm-task:")) {
    const parts = item.key.split(":");
    return parts.length >= 4 ? parts.at(-2) ?? "" : parts.at(-1) ?? "";
  }
  return "";
}

function taskIdFromMove(move: AtlasUniversalMove) {
  return move.key.startsWith("farm-task:") ? move.key.split(":").at(-1) ?? "" : "";
}

function usefulDetail(card: AtlasTaskCard, title: string, location: string) {
  const display = atlasTaskDisplay(card);
  return [
    card.status === "blocked" ? card.blocker_text : null,
    display.detail,
    card.note,
  ]
    .map((value) => clean(value))
    .find((value) => value
      && value.toLowerCase() !== title.toLowerCase()
      && value.toLowerCase() !== location.toLowerCase()) ?? "";
}

function overdueMove(
  ref: FarmTaskRef,
  index: number,
  multiFarm: boolean,
): AtlasUniversalMove {
  const { farm, card } = ref;
  const display = atlasTaskDisplay(card);
  const title = clean(display.title) || card.title;
  const location = clean(display.location) || farm.farmName;
  const scopeLabel = multiFarm && normalized(location) !== normalized(farm.farmName)
    ? `${farm.farmName} · ${location}`
    : location;
  const state: AtlasUniversalMoveState = card.status === "blocked" ? "blocked" : "ready";

  return {
    key: `farm-task:${farm.farmId}:${card.task_id}`,
    kind: "farm_task",
    category: `Overdue · ${atlasDayTaskFamily(card)}`,
    title,
    scopeLabel,
    meta: atlasDayTaskCues(card).join(" · "),
    detail: usefulDetail(card, title, location),
    href: `/task-focus/${encodeURIComponent(card.task_id)}?returnTo=${encodeURIComponent("/")}`,
    date: card.due_date,
    state,
    farmId: farm.farmId,
    projectId: null,
    priority: index,
  };
}

function overdueTaskRefs(
  home: AtlasUniversalHomeModel,
  overview: AtlasHomeTaskOverview,
): FarmTaskRef[] {
  const today = home.window.doneDate;
  const scopedIds = new Set(
    overview.datedItems
      .filter((item) => isOpenDatedItem(item) && item.date < today)
      .map(taskIdFromDatedItem)
      .filter(Boolean),
  );

  const refs: FarmTaskRef[] = [];
  home.farms.forEach((farm) => {
    farm.taskCards.forEach((card) => {
      if (!scopedIds.has(card.task_id)) return;
      if (!isOpenDisplayTask(card) || !card.due_date || card.due_date >= today) return;
      refs.push({ farm, card });
    });
  });

  return refs.sort((left, right) => {
    const dateOrder = (left.card.due_date ?? "9999-12-31")
      .localeCompare(right.card.due_date ?? "9999-12-31");
    if (dateOrder) return dateOrder;
    return atlasWorkOrderSortValue(left.card).localeCompare(atlasWorkOrderSortValue(right.card))
      || left.farm.farmName.localeCompare(right.farm.farmName)
      || left.card.title.localeCompare(right.card.title);
  });
}

/**
 * The purple Home cover is an unresolved-work queue, not a today-only plan.
 * Today's completion denominator remains untouched; overdue displayable tasks
 * are simply prepended to the visible moves, oldest first.
 */
export function withAtlasHomeCarryForward(
  home: AtlasUniversalHomeModel,
  overview: AtlasHomeTaskOverview,
): AtlasHomeTaskOverview {
  const overdueRefs = overdueTaskRefs(home, overview);
  if (overdueRefs.length === 0) return overview;

  const overdueIds = new Set(overdueRefs.map(({ card }) => card.task_id));
  const remainingMoves = overview.moves.filter((move) => {
    const taskId = taskIdFromMove(move);
    return !taskId || !overdueIds.has(taskId);
  });
  const overdueMoves = overdueRefs.map((ref, index) => overdueMove(
    ref,
    index,
    home.farms.length > 1,
  ));

  return {
    ...overview,
    moves: [...overdueMoves, ...remainingMoves].slice(0, 4),
    summary: {
      ...overview.summary,
      carryForwardCount: Math.max(overview.summary.carryForwardCount, overdueRefs.length),
    },
  };
}
