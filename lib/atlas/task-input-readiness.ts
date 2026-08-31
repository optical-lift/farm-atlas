export type AtlasTaskInputRequirement = "none" | "human_observation" | "human_measurement";

export type AtlasTaskInputReadiness = {
  state: "ready" | "awaiting_input_contract";
  executable: boolean;
  reason: string | null;
};

export function resolveAtlasTaskInputReadiness({
  requirement,
  inputContractId,
}: {
  requirement: AtlasTaskInputRequirement;
  inputContractId?: string | null;
}): AtlasTaskInputReadiness {
  if (requirement === "none") {
    return { state: "ready", executable: true, reason: null };
  }

  if (inputContractId?.trim()) {
    return { state: "ready", executable: true, reason: null };
  }

  return {
    state: "awaiting_input_contract",
    executable: false,
    reason: "Human observation or measurement requires an input contract before the task is executable.",
  };
}
