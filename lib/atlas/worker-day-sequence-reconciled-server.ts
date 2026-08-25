import "server-only";

import { createAtlasServerClient } from "@/lib/supabase/server";
import { readWorkerDaySequence as readCanonicalWorkerDaySequence } from "@/lib/atlas/worker-day-sequence-server";

function metadataText(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Future mowing slots are provisional. If the owner has explicitly moved the
 * same mowing route to a later active task, that scheduled task is stronger
 * truth and the route must not also appear on an earlier future day.
 */
async function suppressContradictedFutureMowing(
  dateIso: string,
  result: Awaited<ReturnType<typeof readCanonicalWorkerDaySequence>>,
) {
  if (!result.active || !result.projection || !result.target) return result;

  const automaticMowing = result.projection.sequence.items.filter((item) => (
    item.kind === "committed_task"
    && item.automatic
    && item.sourceKind === "rhythm"
    && /^mow\b/i.test(item.title)
  ));
  if (!automaticMowing.length) return result;

  const supabase = await createAtlasServerClient();
  const ruleIds = Array.from(new Set(automaticMowing.map((item) => item.sourceId).filter(Boolean)));
  const [{ data: rules, error: ruleError }, { data: tasks, error: taskError }] = await Promise.all([
    supabase.from("rhythm_rules").select("id, rule_key").in("id", ruleIds),
    supabase
      .from("tasks")
      .select("id, due_date, metadata, action_key, status")
      .eq("farm_id", result.target.farmId)
      .eq("assigned_membership_id", result.target.membershipId)
      .eq("action_key", "mow")
      .in("status", ["open", "blocked"])
      .gt("due_date", dateIso),
  ]);
  if (ruleError || taskError) {
    console.warn("Atlas could not reconcile future mowing projection against explicit task truth.", ruleError ?? taskError);
    return result;
  }

  const routeByRuleId = new Map<string, string>();
  for (const rule of rules ?? []) {
    const ruleKey = typeof rule.rule_key === "string" ? rule.rule_key.replace(/^elm_/, "") : "";
    if (ruleKey) routeByRuleId.set(rule.id, ruleKey);
  }

  const explicitlyScheduledRoutes = new Set<string>();
  for (const task of tasks ?? []) {
    const route = metadataText(task.metadata, "mowing_route_key")
      || metadataText(task.metadata, "canonical_collection_member_key");
    if (route) explicitlyScheduledRoutes.add(route.startsWith("mowing_") ? route : `mowing_${route}`);
  }
  if (!explicitlyScheduledRoutes.size) return result;

  const suppressedIds = new Set(
    automaticMowing
      .filter((item) => explicitlyScheduledRoutes.has(routeByRuleId.get(item.sourceId) ?? ""))
      .map((item) => item.id),
  );
  if (!suppressedIds.size) return result;

  const items = result.projection.sequence.items.filter((item) => !suppressedIds.has(item.id));
  return {
    ...result,
    projection: {
      ...result.projection,
      sequence: { ...result.projection.sequence, items },
    },
    sequence: { ...result.sequence, items },
  };
}

export async function readWorkerDaySequence(dateIso: string) {
  const result = await readCanonicalWorkerDaySequence(dateIso);
  return suppressContradictedFutureMowing(dateIso, result);
}
