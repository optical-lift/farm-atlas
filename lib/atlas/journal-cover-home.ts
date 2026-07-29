import "server-only";

import type {
  AtlasLivingDay,
  AtlasLivingDayCarriedRhythm,
  AtlasLivingDayGoal,
  AtlasLivingDayOwnerDecision,
} from "@/lib/atlas/living-day-contract";
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

type CoverRole = "current" | "next" | "unlock" | "blocker";

type LivingDayRpcError = { message?: string };

const coverMark: Record<CoverRole, string> = {
  current: "●",
  next: "○",
  unlock: "~",
  blocker: "!",
};

function isChildTask(card: AtlasTaskCard) {
  return Boolean(card.parent_task_id)
    || atlasMetadataValue(card, "is_child_task") === true
    || atlasMetadataValue(card, "is_child_task") === "true";
}

function isPlayableTask(card: AtlasTaskCard) {
  const joined = `${card.task_type ?? ""} ${card.title} ${card.unlock_text ?? ""}`.toLowerCase();
  const checklistStatus = (atlasMetaString(card, "checklist_status") ?? "").toLowerCase();
  return card.status === "open"
    && checklistStatus !== "done"
    && !isChildTask(card)
    && !(joined.includes("verify")
      || joined.includes("check")
      || joined.includes("confirm")
      || joined.includes("count")
      || joined.includes("germin")
      || joined.includes("walk field rows"));
}

function compactPlace(value: string) {
  return value
    .replace(/^Field Row\s+/i, "FR")
    .replace(/^Entry Billboard Bed\s+/i, "EB")
    .replace(/^Entry Billboard Beds\s+/i, "EB")
    .replace(/\s*-\s*/g, "–")
    .trim();
}

function looksLikePlace(value: string) {
  return /^(Field Row|FR\d|Entry Billboard|EB\d|MG\d|Main Garden|Grow Room|Barn|Berry Walk|Redbud|Mailbox)/i.test(value);
}

function cropLabel(card: AtlasTaskCard) {
  return atlasMetaString(card, "main_crop_label")
    || atlasMetaString(card, "crop_variety")
    || atlasMetaString(card, "crop_label")
    || atlasMetaString(card, "variety")
    || null;
}

function lowerGenericCrop(value: string) {
  if (/^(ProCut|Potomac|Queensland|Italian|White Lite)/.test(value)) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function taskSubject(card: AtlasTaskCard) {
  const displaySubject = atlasMetaString(card, "display_subject") ?? "";
  const displayDetail = atlasMetaString(card, "display_detail") ?? "";
  const crop = cropLabel(card);
  const place = looksLikePlace(displaySubject)
    ? compactPlace(displaySubject)
    : looksLikePlace(displayDetail)
      ? compactPlace(displayDetail)
      : compactPlace(
        card.title
          .replace(/^(Weed|Mow|Water|Sow|Plant|Transplant|Check|Harvest watch\s*[—-]?)\s+/i, "")
          .replace(/\s+(zinnias|sunflowers|cosmos|dahlias)$/i, ""),
      );
  const namedCrop = crop || (!looksLikePlace(displaySubject) ? displaySubject : "");
  if (place && namedCrop && !place.toLowerCase().includes(namedCrop.toLowerCase())) {
    return `${place} ${lowerGenericCrop(namedCrop)}`;
  }
  return place || namedCrop || atlasTaskDisplay(card).title;
}

function taskMovement(card: AtlasTaskCard) {
  const action = (card.action_key
    || atlasMetaString(card, "display_action")
    || card.task_type
    || "").toLowerCase();
  const partial = /partly|partial|continue/i.test(card.note ?? "")
    || (atlasMetaString(card, "checklist_status") ?? "").toLowerCase() === "partial";
  const crop = cropLabel(card);

  if (action.includes("weed")) {
    if (partial) return "Continue the recovery block";
    if (crop) return "Return the row to production";
    return "Return the place to rhythm";
  }
  if (action.includes("sow")) return "Put the block in production";
  if (action.includes("transplant") || action.includes("plant")) return "Set the crop in place";
  if (action.includes("harvest")) return "First usable cut will open harvest";
  if (action.includes("mow")) return "Return the route to rhythm";
  if (action.includes("water")) return "Carry the crop through the day";
  if (action.includes("owner") || action.includes("decide")) return "A decision holds the next move";
  if (card.blocker_text) return "A prerequisite holds the next move";
  return "Move the farm one state forward";
}

function taskState(card: AtlasTaskCard, dateIso: string): AtlasUniversalMoveState {
  if (card.status === "blocked") return "blocked";
  if (card.due_date && card.due_date < dateIso) return "attention";
  return "ready";
}

function taskMove(
  card: AtlasTaskCard,
  farmId: string,
  farmName: string,
  dateIso: string,
): AtlasUniversalMove {
  return {
    key: `farm-task:${farmId}:${card.task_id}`,
    kind: "farm_task",
    category: "",
    title: taskSubject(card),
    scopeLabel: farmName,
    meta: "",
    detail: taskMovement(card),
    href: `/task-focus/${encodeURIComponent(card.task_id)}?returnTo=${encodeURIComponent("/")}`,
    date: card.due_date,
    state: taskState(card, dateIso),
    farmId,
    projectId: null,
    priority: 0,
  };
}

function fallbackPlayableMoves(home: AtlasUniversalHomeModel) {
  return home.moves.filter((move) => move.kind !== "attention"
    && move.state !== "blocked"
    && move.state !== "waiting"
    && move.state !== "review"
    && move.state !== "complete"
    && move.state !== "quiet");
}

function orderedFarmMoves(home: AtlasUniversalHomeModel, dateIso: string) {
  const farm = home.activeFarm;
  if (!farm) return [];
  const cards = farm.taskCards
    .filter(isPlayableTask)
    .sort((left, right) => {
      const leftDate = left.due_date ?? "9999-12-31";
      const rightDate = right.due_date ?? "9999-12-31";
      const leftBand = leftDate <= dateIso ? 0 : 1;
      const rightBand = rightDate <= dateIso ? 0 : 1;
      return leftBand - rightBand
        || leftDate.localeCompare(rightDate)
        || atlasWorkOrderSortValue(left).localeCompare(atlasWorkOrderSortValue(right));
    });
  return cards.map((card) => taskMove(card, farm.farmId, farm.farmName, dateIso));
}

function goalRank(goal: AtlasLivingDayGoal) {
  const stateRank: Record<AtlasLivingDayGoal["state"], number> = {
    nearly_unlocked: 0,
    tracking: 1,
    in_production: 2,
    locked: 3,
    realized: 4,
  };
  const windowRank = goal.window?.state === "open"
    ? 0
    : goal.window?.state === "waiting"
      ? 1
      : goal.window?.state === "passed_without_observation"
        ? 2
        : 3;
  const ratio = goal.progress.total > 0 ? goal.progress.satisfied / goal.progress.total : 0;
  return [stateRank[goal.state], windowRank, -ratio, goal.title] as const;
}

function compareGoal(left: AtlasLivingDayGoal, right: AtlasLivingDayGoal) {
  const leftRank = goalRank(left);
  const rightRank = goalRank(right);
  return leftRank[0] - rightRank[0]
    || leftRank[1] - rightRank[1]
    || leftRank[2] - rightRank[2]
    || leftRank[3].localeCompare(rightRank[3]);
}

function goalJournalCopy(goal: AtlasLivingDayGoal) {
  if (goal.goalKey === "elm_fr15_procut_horizon_stand_v1") {
    return {
      title: "FR15 Horizon",
      detail: goal.window?.state === "satisfied" || goal.state === "realized"
        ? "Stand confirmed"
        : goal.window?.state === "passed_without_observation"
          ? "The stand needs a field decision"
          : "Emergence will confirm the stand",
    };
  }
  if (goal.goalKey === "elm_eb1_eb6_procut_open_v1") {
    return {
      title: "EB1–6 ProCut",
      detail: goal.state === "nearly_unlocked" || goal.state === "in_production"
        ? "The production block is opening"
        : "Clearance + approval hold the block",
    };
  }
  if (goal.goalKey === "elm_fr11_fr14_october_sunflowers_v1") {
    return {
      title: "FR11–14 sunflowers",
      detail: goal.state === "realized"
        ? "October block established"
        : "Each sown bed advances the October block",
    };
  }
  return {
    title: "FR4–6 zinnias",
    detail: goal.state === "realized"
      ? "First cut opened"
      : "Protected rows will open the first cut",
  };
}

function goalMove(
  goal: AtlasLivingDayGoal,
  farmId: string,
  dateIso: string,
  mode: "unlock" | "blocker" = "unlock",
): AtlasUniversalMove {
  const returnTo = `/journal?date=${encodeURIComponent(dateIso)}`;
  const copy = goalJournalCopy(goal);
  return {
    key: `goal:${goal.goalKey}:${mode}`,
    kind: "attention",
    category: "",
    title: copy.title,
    scopeLabel: "",
    meta: "",
    detail: copy.detail,
    href: goal.nextMove
      ? `/task-focus/${encodeURIComponent(goal.nextMove.taskId)}?returnTo=${encodeURIComponent(returnTo)}`
      : returnTo,
    date: goal.window?.start ?? null,
    state: mode === "blocker"
      ? "blocked"
      : goal.state === "nearly_unlocked" || goal.state === "in_production"
        ? "moving"
        : "waiting",
    farmId,
    projectId: null,
    priority: 0,
  };
}

function ownerDecisionMove(entry: AtlasLivingDayOwnerDecision, farmId: string, dateIso: string): AtlasUniversalMove {
  const returnTo = `/journal?date=${encodeURIComponent(dateIso)}`;
  const entryTitle = entry.title
    .replace(/^Owner\s*[—-]\s*/i, "")
    .replace(/^Decide\s+/i, "")
    .replace(/^2026\s+/i, "");
  const title = /Entry Billboard.*ProCut/i.test(entryTitle) ? "EB1–6 ProCut" : entryTitle;
  return {
    key: `decision:${entry.entryKey}`,
    kind: "attention",
    category: "",
    title,
    scopeLabel: "",
    meta: "",
    detail: "A decision holds the next move",
    href: `/task-focus/${encodeURIComponent(entry.taskId)}?returnTo=${encodeURIComponent(returnTo)}`,
    date: entry.dueDate,
    state: "blocked",
    farmId,
    projectId: null,
    priority: 0,
  };
}

function rhythmMove(entry: AtlasLivingDayCarriedRhythm, farmId: string, dateIso: string): AtlasUniversalMove {
  const returnTo = `/journal?date=${encodeURIComponent(dateIso)}`;
  return {
    key: `rhythm:${entry.entryKey}`,
    kind: "attention",
    category: "",
    title: compactPlace(entry.objectLabel),
    scopeLabel: "",
    meta: "",
    detail: entry.state === "fallen_out_of_rhythm"
      ? "The stewardship lease has fallen out of rhythm"
      : "Partial work is restoring the lease",
    href: entry.currentTask
      ? `/task-focus/${encodeURIComponent(entry.currentTask.taskId)}?returnTo=${encodeURIComponent(returnTo)}`
      : returnTo,
    date: entry.failureAt ?? entry.dueAt,
    state: entry.state === "fallen_out_of_rhythm" ? "blocked" : "attention",
    farmId,
    projectId: null,
    priority: 0,
  };
}

function closestUnlock(livingDay: AtlasLivingDay | null, dateIso: string) {
  if (!livingDay) return null;
  const goal = livingDay.goals
    .filter((entry) => entry.state !== "realized")
    .sort(compareGoal)[0];
  return goal ? goalMove(goal, livingDay.farmId, dateIso) : null;
}

function activeBlocker(home: AtlasUniversalHomeModel, livingDay: AtlasLivingDay | null, dateIso: string) {
  const farm = home.activeFarm;
  const blockedGoal = livingDay?.goals
    .filter((goal) => goal.state !== "realized" && Boolean(goal.blocker))
    .sort((left, right) => left.progress.satisfied - right.progress.satisfied || compareGoal(left, right))[0];
  if (blockedGoal && livingDay) return goalMove(blockedGoal, livingDay.farmId, dateIso, "blocker");
  if (livingDay?.ownerDecisions.length) {
    const decision = [...livingDay.ownerDecisions]
      .sort((left, right) => (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31"))[0];
    return ownerDecisionMove(decision, livingDay.farmId, dateIso);
  }
  if (livingDay?.carriedRhythms.length) {
    const rhythm = [...livingDay.carriedRhythms]
      .sort((left, right) => Number(left.state !== "fallen_out_of_rhythm") - Number(right.state !== "fallen_out_of_rhythm")
        || (left.failureAt ?? left.dueAt ?? "9999-12-31").localeCompare(right.failureAt ?? right.dueAt ?? "9999-12-31"))[0];
    return rhythmMove(rhythm, livingDay.farmId, dateIso);
  }
  if (farm) {
    const blocked = farm.taskCards
      .filter((card) => card.status === "blocked" && !isChildTask(card))
      .sort((left, right) => atlasWorkOrderSortValue(left).localeCompare(atlasWorkOrderSortValue(right)))[0];
    if (blocked) return taskMove(blocked, farm.farmId, farm.farmName, dateIso);
  }
  return home.moves.find((move) => move.state === "blocked" || move.kind === "attention") ?? null;
}

function quietMove(role: CoverRole, dateIso: string): AtlasUniversalMove {
  return {
    key: `quiet:${role}:${dateIso}`,
    kind: "attention",
    category: "",
    title: "",
    scopeLabel: "",
    meta: "",
    detail: "",
    href: `/journal?date=${encodeURIComponent(dateIso)}`,
    date: dateIso,
    state: "quiet",
    farmId: null,
    projectId: null,
    priority: 0,
  };
}

function withRole(role: CoverRole, move: AtlasUniversalMove | null, dateIso: string) {
  const resolved = move ?? quietMove(role, dateIso);
  return {
    ...resolved,
    key: `cover:${role}:${resolved.key}`,
    category: coverMark[role],
  };
}

export function buildAtlasJournalCover(
  home: AtlasUniversalHomeModel,
  livingDay: AtlasLivingDay | null,
  dateIso: string,
) {
  const farmMoves = orderedFarmMoves(home, dateIso);
  const fallbacks = fallbackPlayableMoves(home);
  const current = farmMoves[0] ?? fallbacks[0] ?? null;
  const next = farmMoves.find((move) => move.key !== current?.key)
    ?? fallbacks.find((move) => move.key !== current?.key)
    ?? null;
  return [
    withRole("current", current, dateIso),
    withRole("next", next, dateIso),
    withRole("unlock", closestUnlock(livingDay, dateIso), dateIso),
    withRole("blocker", activeBlocker(home, livingDay, dateIso), dateIso),
  ];
}

export async function readAtlasJournalCover(home: AtlasUniversalHomeModel) {
  const dateIso = home.window.doneDate;
  if (!home.activeFarm?.farmId) return buildAtlasJournalCover(home, null, dateIso);
  try {
    const supabase = await createAtlasServerClient();
    const { data, error } = await supabase.rpc("living_day_v1", {
      p_farm_id: home.activeFarm.farmId,
      p_day: dateIso,
    });
    if (error) throw error as LivingDayRpcError;
    return buildAtlasJournalCover(home, data as AtlasLivingDay, dateIso);
  } catch {
    return buildAtlasJournalCover(home, null, dateIso);
  }
}
