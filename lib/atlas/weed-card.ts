import "server-only";

import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasWeedCondition = "heavy" | "medium_pressure" | "row_readable" | "mostly_clear" | "clear";

export type AtlasWeedSession = {
  id: string;
  workDate: string;
  minutes: number;
  conditionBefore: AtlasWeedCondition;
  conditionAfter: AtlasWeedCondition;
  note: string | null;
  recordedAt: string;
};

export type AtlasWeedCardContext = {
  taskId: string;
  taskStatus: string;
  taskDueDate: string | null;
  cardId: string;
  passId: string | null;
  passStatus: "active" | "closed";
  objectId: string;
  objectKey: string;
  objectLabel: string;
  zoneLabel: string;
  cropLabel: string;
  condition: AtlasWeedCondition;
  targetCondition: AtlasWeedCondition;
  totalMinutes: number;
  sessionCount: number;
  nextReviewOn: string | null;
  sessions: AtlasWeedSession[];
};

export type AtlasWeedCardSessionInput = {
  taskId: string;
  minutes: number;
  conditionAfter: AtlasWeedCondition;
  workDate: string;
  note?: string;
  idempotencyKey?: string;
};

export type AtlasWeedCardSessionResult = {
  sessionId: string;
  taskId: string;
  nextTaskId: string | null;
  cardId: string;
  passId: string;
  minutes: number;
  conditionAfter: AtlasWeedCondition;
  passClosed: boolean;
  nextReviewOn: string | null;
  deduplicated: boolean;
};

export async function readAtlasWeedCardTask(taskId: string): Promise<AtlasWeedCardContext | null> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("weed_card_task_focus_v1", { p_task_id: taskId });
  if (error) {
    if (error.code === "P0002") return null;
    throw new Error(error.message);
  }
  return (data as AtlasWeedCardContext | null) ?? null;
}
