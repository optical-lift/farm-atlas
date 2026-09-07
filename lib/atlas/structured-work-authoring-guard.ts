import "server-only";

/**
 * Release A1 compatibility boundary.
 *
 * These are the only application-level prose-first operational writers that
 * may remain active while Structured Work Writer is being built. Adding a new
 * entry here is an architecture change: inventory it in the A1 compatibility
 * document and update the guard test deliberately.
 */
export const LEGACY_PROSE_WORK_WRITER_IDS = [
  "manual-task-v1",
  "project-task-v1",
] as const;

export type LegacyProseWorkWriterId = (typeof LEGACY_PROSE_WORK_WRITER_IDS)[number];

export function assertLegacyProseWorkWriterRegistered(
  writerId: LegacyProseWorkWriterId,
) {
  if (!LEGACY_PROSE_WORK_WRITER_IDS.includes(writerId)) {
    throw new Error(`Unregistered prose-first work writer: ${writerId}`);
  }
}
