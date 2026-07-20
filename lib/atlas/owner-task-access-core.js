export function ownerMembershipForTask(session, task) {
  if (!session || !task || typeof task.farm_id !== "string") return null;
  const memberships = Array.isArray(session.memberships) ? session.memberships : [];
  return memberships.find(
    (membership) =>
      membership?.role === "owner" && membership?.farmId === task.farm_id,
  ) ?? null;
}
