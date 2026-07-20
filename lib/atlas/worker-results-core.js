function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildWorkerResultMemory(rows) {
  return (Array.isArray(rows) ? rows : []).map((value) => {
    const row = asRecord(value);
    return {
      transitionId: text(row.transition_id),
      taskId: text(row.task_id),
      taskTitle: text(row.task_title) ?? "Task",
      taskType: text(row.task_type) ?? "general",
      transition: text(row.transition) ?? "note",
      note: text(row.note),
      reason: text(row.reason),
      occurredAt: text(row.occurred_at),
      zoneId: text(row.zone_id),
      zoneKey: text(row.zone_key),
      zoneLabel: text(row.zone_label),
      actorMembershipId: text(row.actor_membership_id),
      actorDisplayName: text(row.actor_display_name) ?? "Farm Hand",
      actorWorkerKey: text(row.actor_worker_key),
    };
  });
}
