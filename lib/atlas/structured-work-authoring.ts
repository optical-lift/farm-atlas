import "server-only";

import { assertStructuredSemanticPayload } from "@/lib/atlas/structured-work-authoring-core.js";

/**
 * Release A1's single approved entry boundary for NEW structured-work code.
 *
 * A2 will replace the deliberately generic component type with the governed
 * ten-box Work Grammar. This function does not write canonical work yet; it
 * prevents new code from treating prose as the semantics while that writer is
 * being built.
 */
export type StructuredWorkAuthoringSeed = {
  semanticComponents: readonly Record<string, unknown>[];
  sourceProse?: string | null;
};

export function beginStructuredWorkAuthoring(
  seed: StructuredWorkAuthoringSeed,
): StructuredWorkAuthoringSeed {
  assertStructuredSemanticPayload(seed);
  return seed;
}
