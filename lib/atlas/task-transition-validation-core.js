import { isValidAtlasTaskId } from "./task-routing-core.js";

export function validAtlasDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

export function validateAtlasTransitionRequest({ requestOrigin, expectedOrigin, intent, taskId, transition, supportedTransitions, idempotencyKey, targetDate, note, payload, existingFieldLogId }) {
  if (!requestOrigin || requestOrigin !== expectedOrigin) return { status: 403, error: "Task transitions require a same-origin request." };
  if (intent !== "task-transition-v1") return { status: 403, error: "Missing Atlas task-transition intent." };
  if (!isValidAtlasTaskId(taskId)) return { status: 400, error: "A valid task id is required." };
  if (!supportedTransitions.has(transition)) return { status: 400, error: "Unsupported task transition." };
  if (!idempotencyKey || idempotencyKey.length > 160) return { status: 400, error: "A valid idempotency key is required." };
  if (targetDate && !validAtlasDate(targetDate)) return { status: 400, error: "Target date must use YYYY-MM-DD." };
  const nextDayIntent = payload?.scheduleIntent === "next_day";
  if ((transition === "rescheduled" || transition === "unfinished") && !targetDate && !nextDayIntent) return { status: 400, error: "This transition requires a target date or supported scheduling intent." };
  if (nextDayIntent && transition !== "rescheduled") return { status: 400, error: "Next-day scheduling is only valid for rescheduled tasks." };
  if (note && note.length > 4000) return { status: 400, error: "Note must be 4000 characters or fewer." };
  if (existingFieldLogId && !isValidAtlasTaskId(existingFieldLogId)) return { status: 400, error: "Existing field log id is invalid." };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { status: 400, error: "Task transition payload must be an object." };
  return null;
}
