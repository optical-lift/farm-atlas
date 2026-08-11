import "server-only";

import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasNoelTransitionContext = {
  contractVersion: "atlas_noel_transition_context_v1" | string;
  taskId: string;
  farmId: string;
  taskContext: Record<string, unknown>;
  workCharacter: Record<string, unknown>;
  projectContext: Array<Record<string, unknown>>;
  farmTransition: Record<string, unknown>;
  separation: {
    atlasOwnsFarmPriority?: boolean;
    noelCandidateSelectionIsOwnerMediated?: boolean;
    somaticSelectionIsNotFarmStateEvidence?: boolean;
    somaticAttachmentStorage?: string;
  };
};

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function readOwnerNoelTransitionContext(taskId: string): Promise<AtlasNoelTransitionContext> {
  if (!validUuid(taskId)) throw new Error("A valid task id is required for Noel transition context.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("owner_task_noel_transition_context_api_v1", {
    p_task_id: taskId,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Atlas returned invalid Noel transition context.");
  }

  return data as AtlasNoelTransitionContext;
}
