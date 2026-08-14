import "server-only";

import { assembleWorkerDaySequence } from "@/lib/atlas/day-sequence";
import { readOwnerWorkerDayChoreography } from "@/lib/atlas/day-choreography-server";
import { buildAtlasWorkerDayProjection } from "@/lib/atlas/day-projection";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { readWorkerDayOperationalTaskCards } from "@/lib/atlas/worker-day-operational-task-cards-server";
import { readOwnerWorkerDayPlan } from "@/lib/atlas/worker-day-plan-server";

function validDateIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

export async function readOwnerWorkerDaySequence(dateIso: string) {
  if (!validDateIso(dateIso)) throw new Error("A valid YYYY-MM-DD worker day is required.");
  const planResult = await readOwnerWorkerDayPlan(dateIso);
  if (!planResult.active || !planResult.plan || !planResult.target) {
    return { active: false as const, operatorLabel: planResult.operatorLabel, target: null, projection: null, sequence: null, taskCards: [] as AtlasTaskCard[] };
  }

  const plan = planResult.plan;
  const [choreographyResult, taskCards] = await Promise.all([
    readOwnerWorkerDayChoreography(dateIso),
    readWorkerDayOperationalTaskCards(plan),
  ]);
  const choreography = choreographyResult.active ? choreographyResult.choreography : null;
  const sameTarget = Boolean(choreographyResult.active && choreographyResult.target?.farmId === planResult.target.farmId && choreographyResult.target?.membershipId === planResult.target.membershipId);
  const assembled = assembleWorkerDaySequence({
    serviceDate: plan.serviceDate || dateIso,
    realWork: plan.realWork,
    automaticWork: plan.automaticWork,
    suggestions: plan.suggestions,
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
    lens: planResult.target.source,
    sequence,
    reservations: sameTarget ? choreographyResult.reservations : [],
  });
  return {
    active: true as const,
    operatorLabel: planResult.operatorLabel,
    target: planResult.target,
    projection,
    sequence: projection.sequence,
    taskCards,
  };
}
