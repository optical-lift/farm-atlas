import "server-only";

import { taskMatchesAssignee } from "@/lib/atlas/task-assignment";
import { atlasTaskDisplay } from "@/lib/atlas/task-display";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import type { AtlasUniversalFarmScope, AtlasUniversalHomeModel, AtlasUniversalMove } from "@/lib/atlas/universal-home";
import { atlasWorkOrderSortValue } from "@/lib/atlas/work-order";

export type AtlasDailyHandSlot =
  | "heartbeat"
  | "future_money"
  | "production"
  | "physical"
  | "watch_decision";

type HandCandidate = {
  farm: AtlasUniversalFarmScope;
  card: AtlasTaskCard;
  slot: AtlasDailyHandSlot;
};

const SLOT_ORDER: AtlasDailyHandSlot[] = [
  "heartbeat",
  "future_money",
  "production",
  "physical",
  "watch_decision",
];

const SLOT_LABELS: Record<AtlasDailyHandSlot, string> = {
  heartbeat: "Heartbeat",
  future_money: "Future money",
  production: "Production",
  physical: "Physical progress",
  watch_decision: "Watch / decision",
};

function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[\s/-]+/g, "_");
}

function isChildTask(card: AtlasTaskCard) {
  const metadata = card.metadata ?? {};
  return Boolean(card.parent_task_id)
    || metadata.is_child_task === true
    || metadata.is_child_task === "true";
}

function isQuietTask(card: AtlasTaskCard) {
  const metadata = card.metadata ?? {};
  const value = metadata.hide_from_home_hero ?? metadata.quiet_task;
  return value === true || value === "true" || value === "yes" || value === 1;
}

function isOwnerHandCandidate(card: AtlasTaskCard, today: string) {
  if (card.status !== "open" && card.status !== "blocked") return false;
  if (isChildTask(card) || isQuietTask(card)) return false;
  if (!taskMatchesAssignee(card, "owner")) return false;
  if (!card.due_date) return false;
  return card.due_date <= today;
}

function slotFor(card: AtlasTaskCard): AtlasDailyHandSlot | null {
  const workClass = normalized(card.work_class);
  const taskType = normalized(card.task_type);
  const actionKey = normalized(card.action_key);
  const title = normalized(card.title);
  const haystack = `${workClass} ${taskType} ${actionKey} ${title}`;

  if (
    workClass === "heartbeat"
    || /grow_room_care|water_check|animal|heartbeat|daily_care/.test(haystack)
  ) return "heartbeat";

  if (
    ["revenue", "revenue_business", "business", "postharvest_sales", "sales"].includes(workClass)
    || /booking|buyer|sales|revenue|delivery|outreach|nathan/.test(haystack)
  ) return "future_money";

  if (
    ["seed_starting", "seed_starting_succession", "succession", "planting", "planting_sowing", "sowing", "harvest"].includes(workClass)
    || /seed_start|succession|sow|plant|transplant|harvest/.test(haystack)
  ) return "production";

  if (
    ["infrastructure", "maintenance", "hospitality", "hospitality_presentability"].includes(workClass)
    || /weed|mow|trim|repair|paint|install|setup|reset|presentability/.test(haystack)
  ) return "physical";

  if (
    ["watch", "watch_check", "check", "decision", "record", "record_memory"].includes(workClass)
    || /check|watch|confirm|verify|decision|observe|record|germin/.test(haystack)
  ) return "watch_decision";

  return null;
}

function candidateSortValue(candidate: HandCandidate, today: string) {
  const card = candidate.card;
  const blockedRank = card.status === "blocked" ? "0" : "1";
  const overdueRank = card.due_date && card.due_date < today ? "0" : "1";
  const priority = normalized(card.priority);
  const priorityRank = priority === "critical" || priority === "urgent" || priority === "high"
    ? "0"
    : priority === "low"
      ? "2"
      : "1";
  return `${blockedRank}-${overdueRank}-${priorityRank}-${card.due_date ?? "9999-12-31"}-${atlasWorkOrderSortValue(card)}-${card.title}`;
}

function handMove(candidate: HandCandidate, today: string, index: number): AtlasUniversalMove {
  const { card, farm, slot } = candidate;
  const display = atlasTaskDisplay(card);
  const blocked = card.status === "blocked";
  const overdue = Boolean(card.due_date && card.due_date < today);
  const location = display.location || farm.farmName;
  const meta = [
    blocked ? "blocked" : null,
    overdue && card.due_date ? `carried from ${card.due_date}` : null,
    card.work_class ? card.work_class.replaceAll("_", " ") : null,
  ].filter(Boolean).join(" · ");

  return {
    key: `farm-task:${farm.farmId}:${card.task_id}`,
    kind: "farm_task",
    category: SLOT_LABELS[slot],
    title: display.title || card.title,
    scopeLabel: location,
    meta,
    detail: blocked
      ? card.blocker_text || display.detail || card.unlock_text || card.note || "Blocked"
      : display.detail || card.unlock_text || card.note || "",
    href: `/task-focus/${encodeURIComponent(card.task_id)}?returnTo=${encodeURIComponent("/")}`,
    date: card.due_date,
    state: blocked ? "blocked" : overdue ? "attention" : "ready",
    farmId: farm.farmId,
    projectId: null,
    priority: index,
  };
}

/**
 * Build the owner's small constitutional Daily Hand from durable task cards.
 *
 * The hand deliberately does not mirror every due/overdue task. It protects one
 * card from each operating lane in constitutional order, while allowing an
 * owner blocker to remain visible instead of disappearing from the hand.
 * Staff and non-owner views keep their existing task-overview behavior.
 */
export function buildAtlasOwnerDailyHand(home: AtlasUniversalHomeModel, maxCards = 4) {
  const today = home.window.doneDate;
  const ownerView = home.viewer.farmMemberships.some((membership) => membership.role === "owner");
  if (!ownerView) return null;

  const bySlot = new Map<AtlasDailyHandSlot, HandCandidate[]>();
  SLOT_ORDER.forEach((slot) => bySlot.set(slot, []));

  home.farms.forEach((farm) => {
    farm.taskCards.forEach((card) => {
      if (!isOwnerHandCandidate(card, today)) return;
      const slot = slotFor(card);
      if (!slot) return;
      bySlot.get(slot)?.push({ farm, card, slot });
    });
  });

  bySlot.forEach((candidates) => candidates.sort((left, right) =>
    candidateSortValue(left, today).localeCompare(candidateSortValue(right, today)),
  ));

  const selected: HandCandidate[] = [];
  for (const slot of SLOT_ORDER) {
    if (selected.length >= maxCards) break;
    const next = bySlot.get(slot)?.[0];
    if (next) selected.push(next);
  }

  if (!selected.length) return null;
  return selected.map((candidate, index) => handMove(candidate, today, index));
}
