import { NextResponse } from "next/server";

import { callAtlasGatewayStructured } from "@/lib/atlas/ai-gateway";
import { resolveRoleAccess } from "@/lib/atlas/role-access-core.js";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { getAtlasSession, type AtlasSessionMembership } from "@/lib/atlas/session";
import { getOwnerDashboard, type OwnerAction, type OwnerDashboardProjection } from "@/lib/atlas-data/owner-dashboard";
import { readStoredWorkerWeekProjection, type WorkerWeekProjection } from "@/lib/atlas-data/worker-week-projection";

const MAX_QUESTION_LENGTH = 600;
const MAX_EVIDENCE = 6;
const buckets = new Map<string, { count: number; resetAt: number }>();

type EvidenceKind =
  | "summary"
  | "owner_overdue"
  | "owner_today"
  | "owner_this_week"
  | "owner_later"
  | "blocker"
  | "worker"
  | "worker_plan"
  | "deadline";

type EvidenceRecord = {
  id: string;
  kind: EvidenceKind;
  label: string;
  detail: string;
  href: string | null;
  searchText: string;
};

type AskModelResponse = {
  answer: string;
  evidenceIds: string[];
  limitations: string | null;
};

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    evidenceIds: {
      type: "array",
      maxItems: MAX_EVIDENCE,
      uniqueItems: true,
      items: { type: "string" },
    },
    limitations: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["answer", "evidenceIds", "limitations"],
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function withinRateLimit(key: string) {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (existing.count >= 20) return false;
  existing.count += 1;
  return true;
}

function safeQuestion(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, MAX_QUESTION_LENGTH) : "";
}

function taskDetail(task: OwnerAction) {
  const pieces = [
    task.status,
    task.priority ? `${task.priority} priority` : null,
    task.dueDate ? `due ${task.dueDate}` : "undated",
    task.assignee ? `assigned to ${task.assignee}` : null,
    task.location,
    task.blocker ? `blocked by: ${task.blocker}` : null,
    task.totalSteps ? `${task.completedSteps}/${task.totalSteps} steps complete` : null,
    task.detail,
  ].filter(Boolean);
  return pieces.join(" · ");
}

function addTaskRecords(
  records: EvidenceRecord[],
  kind: Extract<EvidenceKind, "owner_overdue" | "owner_today" | "owner_this_week" | "owner_later" | "deadline">,
  tasks: OwnerAction[],
) {
  tasks.slice(0, 16).forEach((task, index) => {
    const id = `${kind}:${task.id ?? `${index}-${task.title}`}`;
    const detail = taskDetail(task);
    records.push({
      id,
      kind,
      label: task.title,
      detail,
      href: task.id ? (kind.startsWith("owner_") ? `/owner/tasks/${encodeURIComponent(task.id)}` : `/task/${encodeURIComponent(task.id)}`) : null,
      searchText: `${task.title} ${detail}`.toLowerCase(),
    });
  });
}

function buildEvidenceRecords(
  dashboard: OwnerDashboardProjection,
  workerProjections: Array<{ displayName: string; projection: WorkerWeekProjection | null }>,
) {
  const records: EvidenceRecord[] = [];
  const summaryDetail = [
    `${dashboard.counts.overdue} overdue owner tasks`,
    `${dashboard.counts.today} owner tasks due today`,
    `${dashboard.counts.thisWeek} owner tasks due this week`,
    `${dashboard.counts.blocked} blocked owner tasks`,
    `${dashboard.farmBlockers.length} farm blockers surfaced`,
    `${dashboard.counts.decisionRequired} farm objects requiring a decision`,
    `${dashboard.counts.criticalObjects} critical farm objects`,
    `${dashboard.counts.highRiskObjects} high-risk farm objects`,
  ].join(" · ");
  records.push({
    id: "summary:owner",
    kind: "summary",
    label: `${dashboard.farm.name} owner state`,
    detail: summaryDetail,
    href: "/owner",
    searchText: summaryDetail.toLowerCase(),
  });

  addTaskRecords(records, "owner_overdue", dashboard.ownerActions.overdue);
  addTaskRecords(records, "owner_today", dashboard.ownerActions.today);
  addTaskRecords(records, "owner_this_week", dashboard.ownerActions.thisWeek);
  addTaskRecords(records, "owner_later", dashboard.ownerActions.later);
  addTaskRecords(records, "deadline", dashboard.upcomingDeadlines);

  dashboard.farmBlockers.slice(0, 12).forEach((blocker, index) => {
    const detail = [
      blocker.blocker,
      blocker.location,
      blocker.dueDate ? `due ${blocker.dueDate}` : null,
    ].filter(Boolean).join(" · ");
    records.push({
      id: `blocker:${blocker.id ?? `${index}-${blocker.title}`}`,
      kind: "blocker",
      label: blocker.title,
      detail,
      href: blocker.id ? `/task/${encodeURIComponent(blocker.id)}` : null,
      searchText: `${blocker.title} ${detail}`.toLowerCase(),
    });
  });

  dashboard.workerExecution.slice(0, 12).forEach((worker) => {
    const detail = [
      `${worker.open} open`,
      `${worker.blocked} blocked`,
      `${worker.done} done in the visible schedule`,
      worker.nextTask ? `next: ${worker.nextTask.title}${worker.nextTask.dueDate ? ` (${worker.nextTask.dueDate})` : ""}` : "no next task surfaced",
    ].join(" · ");
    records.push({
      id: `worker:${worker.membershipId}`,
      kind: "worker",
      label: worker.displayName,
      detail,
      href: worker.nextTask?.id ? `/task/${encodeURIComponent(worker.nextTask.id)}` : null,
      searchText: `${worker.displayName} ${detail}`.toLowerCase(),
    });
  });

  for (const { displayName, projection } of workerProjections) {
    if (!projection) continue;
    const visibleItems = projection.days.flatMap((day) => day.items.map((item) => ({ day: day.date, item }))).slice(0, 18);
    for (const { day, item } of visibleItems) {
      const detail = [
        day,
        item.planState,
        item.expectedActiveMinutes ? `${item.expectedActiveMinutes} min` : null,
        item.environment,
        item.reason,
      ].filter(Boolean).join(" · ");
      records.push({
        id: `worker_plan:${item.id}`,
        kind: "worker_plan",
        label: `${displayName} — ${item.title}`,
        detail,
        href: item.sourceKind === "task" ? `/task/${encodeURIComponent(item.sourceId)}` : null,
        searchText: `${displayName} ${item.title} ${detail}`.toLowerCase(),
      });
    }
  }

  return records.slice(0, 120);
}

function evidencePayload(record: EvidenceRecord) {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    detail: record.detail,
    href: record.href,
  };
}

function chooseFallback(question: string, records: EvidenceRecord[], dashboard: OwnerDashboardProjection): AskModelResponse {
  const lower = question.toLowerCase();
  let candidates: EvidenceRecord[] = [];
  let answer = "";

  const worker = records.find((record) => record.kind === "worker" && lower.includes(record.label.toLowerCase()));
  if (worker) {
    candidates = [worker, ...records.filter((record) => record.kind === "worker_plan" && record.searchText.includes(worker.label.toLowerCase())).slice(0, 5)];
    answer = `${worker.label}'s current Atlas record is: ${worker.detail}.`;
  } else if (/\b(blocked|blocker|waiting|stuck|cannot|can't)\b/.test(lower)) {
    candidates = records.filter((record) => record.kind === "blocker").slice(0, 5);
    answer = candidates.length
      ? `Atlas currently surfaces ${dashboard.farmBlockers.length} farm blocker${dashboard.farmBlockers.length === 1 ? "" : "s"}. The first ${candidates.length === 1 ? "one is" : "ones are"} ${candidates.map((record) => record.label).join(", ")}.`
      : "Atlas is not currently surfacing a farm blocker in the Owner projection.";
  } else if (/\b(overdue|late|fallen|cracks|missed)\b/.test(lower)) {
    candidates = records.filter((record) => record.kind === "owner_overdue").slice(0, 5);
    answer = candidates.length
      ? `${dashboard.counts.overdue} owner task${dashboard.counts.overdue === 1 ? " is" : "s are"} overdue. ${candidates.map((record) => record.label).join(", ")} ${candidates.length === 1 ? "is" : "are"} at the front of that list.`
      : "Atlas is not currently surfacing an overdue Owner task.";
  } else if (/\b(today|now|first|attention|urgent|priority)\b/.test(lower)) {
    candidates = [
      ...records.filter((record) => record.kind === "owner_overdue").slice(0, 3),
      ...records.filter((record) => record.kind === "owner_today").slice(0, 3),
      ...records.filter((record) => record.kind === "blocker").slice(0, 2),
    ].slice(0, MAX_EVIDENCE);
    answer = `${dashboard.counts.overdue} owner task${dashboard.counts.overdue === 1 ? " is" : "s are"} overdue and ${dashboard.counts.today} ${dashboard.counts.today === 1 ? "is" : "are"} due today. Atlas also surfaces ${dashboard.farmBlockers.length} farm blocker${dashboard.farmBlockers.length === 1 ? "" : "s"}.`;
  } else if (/\b(week|upcoming|next)\b/.test(lower)) {
    candidates = [
      ...records.filter((record) => record.kind === "owner_this_week").slice(0, 3),
      ...records.filter((record) => record.kind === "deadline").slice(0, 3),
    ].slice(0, MAX_EVIDENCE);
    answer = `Atlas currently shows ${dashboard.counts.thisWeek} owner task${dashboard.counts.thisWeek === 1 ? "" : "s"} due later this week, with ${dashboard.upcomingDeadlines.length} upcoming deadline${dashboard.upcomingDeadlines.length === 1 ? "" : "s"} surfaced across the farm.`;
  } else {
    candidates = [records[0], ...records.filter((record) => record.kind === "owner_overdue" || record.kind === "blocker").slice(0, 5)]
      .filter((record): record is EvidenceRecord => Boolean(record));
    answer = `The Owner projection currently shows ${dashboard.counts.overdue} overdue, ${dashboard.counts.today} due today, ${dashboard.counts.thisWeek} due this week, and ${dashboard.farmBlockers.length} surfaced farm blocker${dashboard.farmBlockers.length === 1 ? "" : "s"}.`;
  }

  return {
    answer,
    evidenceIds: candidates.map((record) => record.id),
    limitations: "This first Ask Atlas Owner version reads the Owner, blocker, deadline, and stored worker-week projections only. Harvest, inventory, sales, and deeper crop-state questions are not in its evidence packet yet.",
  };
}

async function askModel(request: Request, question: string, date: string, records: EvidenceRecord[]) {
  const system = `You are Ask Atlas, the read-only institutional assistant inside Atlas.\n\nGOVERNING RULE: the model interprets and summarizes; Atlas records determine reality. Answer ONLY from the supplied RECORDS. Never invent, fill gaps, use outside knowledge, or convert an absence of evidence into a claim that something did or did not happen.\n\nThis is the Owner portal. You may explain owner work, overdue work, blockers, deadlines, worker execution, and stored worker-week projections contained in RECORDS. You must not create, complete, reassign, reschedule, or otherwise mutate work.\n\nIf the question asks about harvest, inventory, sales, weather, detailed crop state, or another domain not actually represented in RECORDS, say that this first Owner version does not yet have that evidence rather than guessing.\n\nUse concise natural language. Distinguish planned/conditional/flexible worker projection items from work already completed. Do not describe delegated worker work as Owner work merely because the Owner can see it.\n\nEvery evidenceIds value must exactly match an id present in RECORDS. Choose only records that materially support the answer. If no record supports a factual claim, do not make the claim.\n\nAtlas date: ${date}.`;

  return callAtlasGatewayStructured<AskModelResponse>(
    request,
    "ask_atlas_owner_v1",
    ANSWER_SCHEMA,
    system,
    JSON.stringify({
      question,
      records: records.map(evidencePayload),
    }),
  );
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: "Request origin rejected." }, 403);

  const session = await getAtlasSession();
  const roleAccess = resolveRoleAccess(session, ["owner"]);
  const membership = roleAccess.membership as AtlasSessionMembership | null;
  if (!session || roleAccess.status !== "authorized" || !membership) {
    return json({ ok: false, error: "Owner access required." }, roleAccess.status === "anonymous" ? 401 : 403);
  }
  if (!withinRateLimit(session.userId)) return json({ ok: false, error: "Ask Atlas is receiving too many requests. Try again shortly." }, 429);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }
  const question = safeQuestion((payload as { question?: unknown } | null)?.question);
  if (!question) return json({ ok: false, error: "Ask Atlas a question first." }, 400);

  const access: AtlasRoleAccess = { session, membership };
  const dashboard = await getOwnerDashboard(access);
  const farmId = dashboard.farm.id;

  const workerProjections = farmId
    ? await Promise.all(dashboard.workerExecution.slice(0, 8).map(async (worker) => ({
        displayName: worker.displayName,
        projection: await readStoredWorkerWeekProjection(farmId, worker.membershipId, dashboard.generatedForDate, 7).catch(() => null),
      })))
    : [];

  const records = buildEvidenceRecords(dashboard, workerProjections);
  let modelResponse: AskModelResponse;
  try {
    modelResponse = await askModel(request, question, dashboard.generatedForDate, records);
  } catch (error) {
    console.error("Ask Atlas Owner synthesis unavailable", error);
    modelResponse = chooseFallback(question, records, dashboard);
  }

  const byId = new Map(records.map((record) => [record.id, record]));
  const evidence = [...new Set(modelResponse.evidenceIds)]
    .map((id) => byId.get(id))
    .filter((record): record is EvidenceRecord => Boolean(record))
    .slice(0, MAX_EVIDENCE)
    .map(evidencePayload);

  return json({
    ok: true,
    question,
    answer: modelResponse.answer.trim(),
    evidence,
    limitations: modelResponse.limitations?.trim() || null,
    answeredForDate: dashboard.generatedForDate,
    readOnly: true,
  });
}
