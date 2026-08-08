import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

export type AtlasTaskResultMode = "standard_execution" | "field_execution";

function metadataText(task: AtlasTaskCard, key: string) {
  const value = task.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function explicitResultMode(task: AtlasTaskCard): AtlasTaskResultMode | null {
  const value = metadataText(task, "task_result_mode");
  return value === "standard_execution" || value === "field_execution" ? value : null;
}

/**
 * Chooses the ordinary result grammar for an assigned task.
 *
 * Specialized task families are routed before this resolver. For everything
 * else, the task's operational shape decides the result surface; the assignee
 * does not. A classified physical operation gets the field conveyor. Ordinary
 * finite execution (calls, admin, research, errands, writing, etc.) uses the
 * canonical Done / Unfinished result grammar.
 */
export function atlasTaskResultMode(task: AtlasTaskCard): AtlasTaskResultMode {
  const explicit = explicitResultMode(task);
  if (explicit) return explicit;

  return metadataText(task, "operation_class")
    ? "field_execution"
    : "standard_execution";
}
