const FORBIDDEN_PROSE_SEMANTIC_KEYS = new Set([
  "title",
  "instructions",
  "display_title",
  "display_detail",
  "detail_lines",
  "display_action",
  "execution_do",
  "execution_how",
  "execution_done_when",
  "execution_statement",
  "worker_script",
  "owner_instruction_text",
  "note",
  "detail",
]);

function isSemanticComponent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const keys = Object.keys(value);
  if (keys.length === 0) return false;

  return keys.some((key) => !FORBIDDEN_PROSE_SEMANTIC_KEYS.has(key));
}

/**
 * Release A1 gate only. A2 will replace the untyped component shape with the
 * governed Work Grammar. Until then, new structured-work code must prove that
 * it carries at least one non-prose semantic component before it can proceed.
 */
export function assertStructuredSemanticPayload(input) {
  if (!input || !Array.isArray(input.semanticComponents)) {
    throw new Error("Structured work authoring requires semantic components.");
  }

  if (!input.semanticComponents.some(isSemanticComponent)) {
    throw new Error("Prose alone cannot establish operational work semantics.");
  }

  return input;
}
