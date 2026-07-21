import {
  buildQuickLogResult,
  validateQuickLogInput,
} from "@/lib/atlas/quick-log-core.js";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export type QuickLogInput = {
  logDate: string;
  actionTypes: string[];
  summarySentence: string;
  note?: string | null;
  zoneIds?: string[];
  objectIds?: string[];
  idempotencyKey: string;
};

export type QuickLogResult = ReturnType<typeof buildQuickLogResult>;

type QuickLogResultRow = {
  field_log_id: string;
  actor_membership_id: string;
  actor_role: string;
  zone_link_count: number | string;
  object_link_count: number | string;
  replayed: boolean;
};

export async function recordQuickLog(
  access: AtlasRoleAccess,
  input: QuickLogInput,
): Promise<QuickLogResult> {
  const validated = validateQuickLogInput(input);
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("record_quick_log_v1", {
    p_farm_id: access.membership.farmId,
    p_log_date: validated.logDate,
    p_action_types: validated.actionTypes,
    p_summary_sentence: validated.summarySentence,
    p_note: validated.note,
    p_zone_ids: validated.zoneIds,
    p_object_ids: validated.objectIds,
    p_idempotency_key: validated.idempotencyKey,
  });

  if (error) {
    throw new Error("Atlas Quick Log write failed.");
  }

  const row = ((data ?? []) as QuickLogResultRow[])[0];
  if (!row?.field_log_id) {
    throw new Error("Atlas Quick Log did not return a field-log record.");
  }

  return buildQuickLogResult(row) as QuickLogResult;
}
