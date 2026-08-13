import "server-only";

import { assembleWorkerDaySequence } from "@/lib/atlas/day-sequence";
import { readOwnerWorkerDayChoreography } from "@/lib/atlas/day-choreography-server";
import { readOwnerWorkerDayPlan } from "@/lib/atlas/worker-day-plan-server";

function validDateIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

export async function readOwnerWorkerDaySequence(dateIso: string) {
  if (!validDateIso(dateIso)) throw new Error("A valid YYYY-MM-DD worker day is required.");

  const planResult = await readOwnerWorkerDayPlan(dateIso);
  if (!planResult.active || !planResult.plan || !planResult.target) {
    return {
      active: false as const,
      operatorLabel: planResult.operatorLabel,
      target: null,
      sequence: null,
    };
  }

  const choreographyResult = await readOwnerWorkerDayChoreography(dateIso);
  const choreography = choreographyResult.active ? choreographyResult.choreography : null;
  const sameTarget = Boolean(
    choreographyResult.active
    && choreographyResult.target?.farmId === planResult.target.farmId
    && choreographyResult.target?.membershipId === planResult.target.membershipId,
  );

  const plan = planResult.plan;
  const sequence = assembleWorkerDaySequence({
    serviceDate: plan.serviceDate || dateIso,
    realWork: plan.realWork,
    automaticWork: plan.automaticWork,
    suggestions: plan.suggestions,
    placements: sameTarget ? (choreography?.placements ?? []) : [],
    cues: sameTarget ? (choreography?.cues ?? []) : [],
  });

  return {
    active: true as const,
    operatorLabel: planResult.operatorLabel,
    target: planResult.target,
    sequence: {
      ...sequence,
      farmId: plan.farmId,
      membershipId: plan.membershipId,
      paidTargetMinutes: plan.paidTargetMinutes,
      committedPaidMinutes: plan.committedPaidMinutes,
      automaticPaidMinutes: plan.automaticPaidMinutes,
      remainingPaidMinutes: plan.remainingPaidMinutes,
      warnings: plan.warnings,
    },
  };
}
