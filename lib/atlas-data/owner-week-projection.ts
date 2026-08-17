export {
  readWorkerWeekProjection as readOwnerWeekProjection,
  readStoredWorkerWeekProjection as readStoredOwnerWeekProjection,
} from "@/lib/atlas-data/worker-week-projection";

export type {
  WorkerWeekProjection as OwnerWeekProjection,
  WorkerWeekProjectionDay as OwnerWeekProjectionDay,
  WorkerWeekProjectionItem as OwnerWeekProjectionItem,
} from "@/lib/atlas-data/worker-week-projection";

/**
 * LEGACY COMPATIBILITY MODULE.
 *
 * The underlying ledger is Worker scheduling truth. New callers should import
 * worker-week-projection directly. These aliases remain temporarily so older
 * Owner surfaces do not break while their imports/routes are migrated.
 */
