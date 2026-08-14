import "server-only";

import { assembleWorkerDaySequence } from "@/lib/atlas/day-sequence";
import { readWorkerDayChoreographyForTarget, type AtlasDayChoreographyTarget } from "@/lib/atlas/day-choreography-server";
import { buildAtlasWorkerDayProjection } from "@/lib/atlas/day-projection";
import { getAtlasSession, type AtlasSession } from "@/lib/atlas/session";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { readWorkerDayOperationalTaskCards } from "@/lib/atlas/worker-day-operational-task-cards-server";
import {
  readOwnerWorkerDayPlan,
  readOwnerWorkerDayPlanForSession,
  type WorkerDayPlan,
} from "@/lib/atlas/worker-day-plan-server";
import { readWorkerSelfDayPlanForTarget } from "@/lib/atlas/worker-self-day-plan-server";

function validDateIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

type WorkerDaySequenceTiming = {
  dateIso: string;
  role: "owner" | "farm_hand" | "inactive" | "unknown";
  sessionMs: number;
  planMs: number;
  choreographyMs: number;
  taskCardsMs: number;
  assemblyMs: number;
  totalMs: number;
};

function nowMs() {
  return performance.now();
}

function elapsedMs(startedAt: number) {
  return Math.round((nowMs() - startedAt) * 10) / 10;
}

async function measured<T>(read: () => Promise<T>) {
  const startedAt = nowMs();
  const value = await read();
  return { value, ms: elapsedMs(startedAt) };
}

function workerSelfTarget(session: AtlasSession): AtlasDayChoreographyTarget | null {
  const activeWorker = session.activeFarmId
    ? session.memberships.find((membership) => membership.farmId === session.activeFarmId && membership.role === "farm_hand")
    : null;
  const worker = activeWorker ?? session.memberships.find((membership) => membership.role === "farm_hand") ?? null;
  if (!worker) return null;
  return {
    farmId: worker.farmId,
    membershipId: worker.membershipId,
    displayName: session.displayName || "Farm Hand",
    source: "worker_self",
  };
}

function assembleProjection(input: {
  dateIso: string;
  plan: WorkerDayPlan;
  target: AtlasDayChoreographyTarget;
  operatorLabel: string;
  choreographyResult: Awaited<ReturnType<typeof readWorkerDayChoreographyForTarget>>;
  taskCards: AtlasTaskCard[];
  canManage: boolean;
}) {
  const { dateIso, plan, target, operatorLabel, choreographyResult, taskCards, canManage } = input;
  const choreography = choreographyResult.active ? choreographyResult.choreography : null;
  const sameTarget = Boolean(
    choreographyResult.active
      && choreographyResult.target?.farmId === target.farmId
      && choreographyResult.target?.membershipId === target.membershipId,
  );
  const assembled = assembleWorkerDaySequence({
    serviceDate: plan.serviceDate || dateIso,
    realWork: plan.realWork,
    automaticWork: plan.automaticWork,
    suggestions: canManage ? plan.suggestions : [],
    placements: sameTarget ? (choreography?.placements ?? []) : [],
    cues: sameTarget ? (choreography?.cues ?? []) : [],
  });
  const sequence = {
    ...assembled,
    availableWorkerDay: plan.availableWorkerDay,
    farmId: plan.farmId,
    membershipId: plan.membershipId,
    paidTargetMinutes: plan.paidTargetMinutes,
    committedPaidMinutes: plan.committedPaidMinutes,
    automaticPaidMinutes: plan.automaticPaidMinutes,
    remainingPaidMinutes: plan.remainingPaidMinutes,
    warnings: plan.warnings,
  };
  const projection = buildAtlasWorkerDayProjection({
    farmId: plan.farmId,
    membershipId: plan.membershipId,
    serviceDate: sequence.serviceDate,
    lens: target.source,
    sequence,
    reservations: sameTarget ? choreographyResult.reservations : [],
  });
  return {
    active: true as const,
    operatorLabel,
    target,
    projection,
    sequence: projection.sequence,
    taskCards,
    canManage,
  };
}

export async function readOwnerWorkerDaySequence(
  dateIso: string,
  session?: AtlasSession,
  timing?: WorkerDaySequenceTiming,
) {
  if (!validDateIso(dateIso)) throw new Error("A valid YYYY-MM-DD worker day is required.");
  const planRead = await measured(() => session
    ? readOwnerWorkerDayPlanForSession(dateIso, session)
    : readOwnerWorkerDayPlan(dateIso));
  if (timing) timing.planMs = planRead.ms;
  const planResult = planRead.value;
  if (!planResult.active || !planResult.plan || !planResult.target) {
    return {
      active: false as const,
      operatorLabel: planResult.operatorLabel,
      target: null,
      projection: null,
      sequence: null,
      taskCards: [] as AtlasTaskCard[],
      canManage: true,
    };
  }

  const plan = planResult.plan;
  const [choreographyRead, taskCardsRead] = await Promise.all([
    measured(() => readWorkerDayChoreographyForTarget(dateIso, planResult.target)),
    measured(() => readWorkerDayOperationalTaskCards(plan)),
  ]);
  if (timing) {
    timing.choreographyMs = choreographyRead.ms;
    timing.taskCardsMs = taskCardsRead.ms;
  }
  const assemblyStartedAt = nowMs();
  const result = assembleProjection({
    dateIso,
    plan,
    target: planResult.target,
    operatorLabel: planResult.operatorLabel,
    choreographyResult: choreographyRead.value,
    taskCards: taskCardsRead.value,
    canManage: true,
  });
  if (timing) timing.assemblyMs = elapsedMs(assemblyStartedAt);
  return result;
}

async function readWorkerSelfDaySequence(
  dateIso: string,
  target: AtlasDayChoreographyTarget,
  timing?: WorkerDaySequenceTiming,
) {
  const [planRead, choreographyRead] = await Promise.all([
    measured(() => readWorkerSelfDayPlanForTarget(dateIso, target)),
    measured(() => readWorkerDayChoreographyForTarget(dateIso, target)),
  ]);
  if (timing) {
    timing.planMs = planRead.ms;
    timing.choreographyMs = choreographyRead.ms;
  }
  const taskCardsRead = await measured(() => readWorkerDayOperationalTaskCards(planRead.value, { includeMoveContext: false }));
  if (timing) timing.taskCardsMs = taskCardsRead.ms;
  const assemblyStartedAt = nowMs();
  const result = assembleProjection({
    dateIso,
    plan: planRead.value,
    target,
    operatorLabel: target.displayName,
    choreographyResult: choreographyRead.value,
    taskCards: taskCardsRead.value,
    canManage: false,
  });
  if (timing) timing.assemblyMs = elapsedMs(assemblyStartedAt);
  return result;
}

export async function readWorkerDaySequence(dateIso: string) {
  if (!validDateIso(dateIso)) throw new Error("A valid YYYY-MM-DD worker day is required.");
  const totalStartedAt = nowMs();
  const timing: WorkerDaySequenceTiming = {
    dateIso,
    role: "unknown",
    sessionMs: 0,
    planMs: 0,
    choreographyMs: 0,
    taskCardsMs: 0,
    assemblyMs: 0,
    totalMs: 0,
  };

  try {
    const sessionRead = await measured(() => getAtlasSession());
    timing.sessionMs = sessionRead.ms;
    const session = sessionRead.value;
    if (!session) {
      timing.role = "inactive";
      return {
        active: false as const,
        operatorLabel: "Farm Hand",
        target: null,
        projection: null,
        sequence: null,
        taskCards: [] as AtlasTaskCard[],
        canManage: false,
      };
    }

    if (session.memberships.some((membership) => membership.role === "owner")) {
      timing.role = "owner";
      return await readOwnerWorkerDaySequence(dateIso, session, timing);
    }

    const target = workerSelfTarget(session);
    if (!target) {
      timing.role = "inactive";
      return {
        active: false as const,
        operatorLabel: session.displayName || "Farm Hand",
        target: null,
        projection: null,
        sequence: null,
        taskCards: [] as AtlasTaskCard[],
        canManage: false,
      };
    }
    timing.role = "farm_hand";
    return await readWorkerSelfDaySequence(dateIso, target, timing);
  } finally {
    timing.totalMs = elapsedMs(totalStartedAt);
    console.info("Atlas Worker Day sequence timing", JSON.stringify(timing));
  }
}
