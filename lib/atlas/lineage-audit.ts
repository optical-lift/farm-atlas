import "server-only";

import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasLineageAuditSummary = {
  pending: number;
  accepted: number;
  rejected: number;
  unresolvedNodes: number;
};

export type AtlasLineageEvidenceItem = {
  evidenceId: string;
  trailBindingId: string;
  nodeKey: string;
  nodeLabel: string;
  nodeOrder: number;
  sourceType: string;
  sourceId: string;
  sourceTitle: string;
  sourceStatus: string | null;
  sourceDate: string | null;
  status: "pending" | "accepted" | "rejected" | "retracted" | string;
  linkMethod: string;
  confidence: number;
  occurredAt: string;
  confirmedAt: string | null;
  subjectKind: string;
  subjectId: string;
  currentNodeKey: string | null;
  bindingStatus: string;
  profileKey: string;
  profileLabel: string;
  projectId: string | null;
  projectTitle: string | null;
  workstream: string | null;
  matchReason: string | null;
  reviewNote: string | null;
};

export type AtlasLineageUnresolvedNode = {
  trailBindingId: string;
  subjectKind: string;
  subjectId: string;
  projectId: string | null;
  projectTitle: string | null;
  workstream: string | null;
  profileKey: string;
  profileLabel: string;
  nodeKey: string;
  nodeLabel: string;
  nodeOrder: number;
  currentNodeKey: string | null;
};

export type AtlasLineageAudit = {
  summary: AtlasLineageAuditSummary;
  items: AtlasLineageEvidenceItem[];
  unresolvedNodes: AtlasLineageUnresolvedNode[];
};

type RpcError = { message?: string };

const emptyAudit: AtlasLineageAudit = {
  summary: {
    pending: 0,
    accepted: 0,
    rejected: 0,
    unresolvedNodes: 0,
  },
  items: [],
  unresolvedNodes: [],
};

export async function readAtlasLineageAudit(organizationId: string): Promise<AtlasLineageAudit> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_trail_lineage_audit_v1", {
    p_organization_id: organizationId,
  });

  if (error) {
    throw new Error((error as RpcError).message || "Trail lineage audit could not be loaded.");
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) return emptyAudit;

  const raw = data as Partial<AtlasLineageAudit>;
  return {
    summary: {
      pending: Number(raw.summary?.pending ?? 0),
      accepted: Number(raw.summary?.accepted ?? 0),
      rejected: Number(raw.summary?.rejected ?? 0),
      unresolvedNodes: Number(raw.summary?.unresolvedNodes ?? 0),
    },
    items: Array.isArray(raw.items) ? raw.items : [],
    unresolvedNodes: Array.isArray(raw.unresolvedNodes) ? raw.unresolvedNodes : [],
  };
}
