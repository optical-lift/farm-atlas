import "server-only";

import { assembleWorkerDaySequence } from "@/lib/atlas/day-sequence";
import { readWorkerDayChoreographyForTarget, type AtlasDayChoreographyTarget } from "@/lib/atlas/day-choreography-server";
import { buildAtlasWorkerDayProjection } from "@/lib/atlas/day-projection";
import { getAtlasSession } from "@/lib/atlas/session";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { readWorkerDayOperationalTaskCards } from "@/lib/atlas/worker-day-operational-task-cards-server";
import { readOwnerWorkerDayPlan, type WorkerDayPlan } from "@/lib/atlas/worker-day-plan-server";
import { readWorkerSelfDayPlanForTarget } from "@/lib/atlas/worker-self-day-plan-server";

function validDateIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function workerSelfTarget(session: Awaited<ReturnType<typeof getAtlasSession>>): AtlasDayChoreographyTarget | null {
  if (!session) return null;
  const farmId = session.activeFarmId ?? session.memberships.find((membership) => membership.role === "farm_hand")?.farmId ?? null;
  if (!farmId) return null;
  const worker = session.memberships.find((membership) => membership.farmId === farmId && membership.role === "farm_hand");
  if (!worker) return null;
  return { farmId, membershipId: worker.membershipId, displayName: session.displayName || "Farm Hand", source: "worker_self" };
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
  const sameTarget = Boolean(choreographyResult.active && choreographyResult.target?.farmId === target.farmId && choreographyResult.target?.membershipId === target.membershipId);
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
  return { active: true as const, operatorLabel, target, projection, sequence: projection.sequence, taskCards, canManage };
}

export async function readOwnerWorkerDaySequence(dateIso: string) {
  if (!validDateIso(dateIso)) throw new Error("A valid YYYY-MM-DD worker day is required.");
  const planResult = await readOwnerWorkerDayPlan(dateIso);
  if (!planResult.active || !planResult.plan || !planResult.target) {
    return { active: false as const, operatorLabel: planResult.operatorLabel, target: null, projection: null, sequence: null, taskCards: [] as AtlasTaskCard[], canManage: true };
  }

  const plan = planResult.plan;
  const [choreographyResult, taskCards] = await Promise.all([
    readWorkerDayChoreographyForTarget(dateIso, planResult.target),
    readWorkerDayOperationalTaskCards(plan),
  ]);
  return assembleProjection({ dateIso, plan, target: planResult.target, operatorLabel: planResult.operatorLabel, choreographyResult, taskCards, canManage: true });
}

async function readWorkerSelfDaySequence(dateIso: string, target: AtlasDayChoreographyTarget) {
  const [plan, choreographyResult] = await Promise.all([
    readWorkerSelfDayPlanForTarget(dateIso, target),
    readWorkerDayChoreographyForTarget(dateIso, target),
  ]);
  const taskCards = await readWorkerDayOperationalTaskCards(plan, { includeMoveContext: false });
  return assembleProjection({ dateIso, plan, target, operatorLabel: target.displayName, choreographyResult, taskCards, canManage: false });
}

export async function readWorkerDaySequence(dateIso: string) {
  if (!validDateIso(dateIso)) throw new Error("A valid YYYY-MM-DD worker day is required.");
  const session = await getAtlasSession();
  if (!session) return { active: false as const, operatorLabel: "Farm Hand", target: null, projection: null, sequence: null, taskCards: [] as AtlasTaskCard[], canManage: false };

  if (session.memberships.some((membership) => membership.role === "owner")) {
    return readOwnerWorkerDaySequence(dateIso);
  }

  const target = workerSelfTarget(session);
  if (!target) return { active: false as const, operatorLabel: session.displayName || "Farm Hand", target: null, projection: null, sequence: null, taskCards: [] as AtlasTaskCard[], canManage: false };
  return readWorkerSelfDaySequence(dateIso, target);
}
