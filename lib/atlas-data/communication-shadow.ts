import { atlasSupabase } from "@/lib/atlas/supabase-server";

export type CommunicationShadowClaim = {
  id: string;
  claimType: string;
  subjectDomain: string;
  subjectKind: string;
  summary: string;
  note: string | null;
  reporterLabel: string | null;
  recipientLabel: string | null;
  ownerAttention: string | null;
  confidence: number | null;
  recordedAt: string | null;
};

export async function readRecentCommunicationShadowClaims(
  userId: string,
  limit = 20,
): Promise<CommunicationShadowClaim[]> {
  const principal = await atlasSupabase
    .schema("atlas")
    .from("principals")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (principal.error) throw new Error(principal.error.message);
  if (!principal.data?.id) return [];

  const result = await atlasSupabase
    .schema("atlas")
    .from("claim_records")
    .select("id,claim_type,subject_domain,subject_kind,value,confidence,recorded_at,created_at")
    .eq("scope_kind", "principal")
    .eq("scope_id", principal.data.id)
    .eq("source_kind", "communication_interpretation_shadow")
    .eq("lifecycle_state", "proposed")
    .order("recorded_at", { ascending: false, nullsFirst: false })
    .limit(Math.max(1, Math.min(limit, 40)));

  if (result.error) throw new Error(result.error.message);

  return (result.data ?? []).map((row) => {
    const value = (row.value ?? {}) as Record<string, unknown>;
    return {
      id: row.id as string,
      claimType: row.claim_type as string,
      subjectDomain: row.subject_domain as string,
      subjectKind: row.subject_kind as string,
      summary: typeof value.summary === "string" ? value.summary : "Communication-derived operational report",
      note: typeof value.note === "string" && value.note ? value.note : null,
      reporterLabel: typeof value.reporterLabel === "string" ? value.reporterLabel : null,
      recipientLabel: typeof value.recipientLabel === "string" ? value.recipientLabel : null,
      ownerAttention: typeof value.ownerAttention === "string" ? value.ownerAttention : null,
      confidence: row.confidence === null ? null : Number(row.confidence),
      recordedAt: (row.recorded_at ?? row.created_at ?? null) as string | null,
    };
  });
}
