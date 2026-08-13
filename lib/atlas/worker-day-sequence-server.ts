import "server-only";

import { assembleWorkerDaySequence, type AtlasDaySequencePlanRowInput } from "@/lib/atlas/day-sequence";
import { readOwnerWorkerDayChoreography } from "@/lib/atlas/day-choreography-server";
import { deriveAtlasTimingMobility } from "@/lib/atlas/timing-mobility";
import { readOwnerWorkerDayPlan } from "@/lib/atlas/worker-day-plan-server";
import { createAtlasServerClient } from "@/lib/supabase/server";

function validDateIso(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

type MobilityTaskRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

async function enrichMobility(
  rows: AtlasDaySequencePlanRowInput[],
  potential: boolean,
): Promise<AtlasDaySequencePlanRowInput[]> {
  const taskIds = Array.from(new Set(rows.map((row) => row.taskId).filter((value): value is string => Boolean(value))));
  if (!taskIds.length) {
    return rows.map((row) => ({
      ...row,
      mobility: deriveAtlasTimingMobility({ location: row.location, potential }),
    }));
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.from("tasks").select("id, metadata").in("id", taskIds);
  if (error) throw new Error("Atlas could not load task mobility truth for the Day sequence.");
  const metadataByTask = new Map((data ?? []).map((task: MobilityTaskRow) => [task.id, task.metadata]));

  return rows.map((row) => ({
    ...row,
    mobility: deriveAtlasTimingMobility({
      metadata: row.taskId ? metadataByTask.get(row.taskId) ?? null : null,
      location: row.location,
      potential,
    }),
  }));
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
  const [realWork, automaticWork, suggestions] = await Promise.all([
    enrichMobility(plan.realWork, false),
    enrichMobility(plan.automaticWork, false),
    enrichMobility(plan.suggestions, true),
  ]);
  const sequence = assembleWorkerDaySequence({
    serviceDate: plan.serviceDate || dateIso,
    realWork,
    automaticWork,
    suggestions,
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