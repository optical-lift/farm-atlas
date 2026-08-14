import "server-only";

import { assembleWorkerDaySequence } from "@/lib/atlas/day-sequence";
import { readOwnerWorkerDayChoreography } from "@/lib/atlas/day-choreography-server";
import { buildAtlasWorkerDayProjection } from "@/lib/atlas/day-projection";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { readOwnerWorkerDayPlan, type WorkerDayPlan } from "@/lib/atlas/worker-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

function validDateIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

async function readOperationalTaskCards(plan: WorkerDayPlan) {
  const taskIds = Array.from(new Set(
    [...plan.realWork, ...plan.automaticWork]
      .map((row) => row.taskId)
      .filter((taskId): taskId is string => Boolean(taskId)),
  ));

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("worker_day_operational_task_cards_v2", {
    p_farm_id: plan.farmId,
    p_membership_id: plan.membershipId,
    p_service_date: plan.serviceDate,
    p_task_ids: taskIds,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as AtlasTaskCard[] : [];
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
    readOperationalTaskCards(plan),
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
