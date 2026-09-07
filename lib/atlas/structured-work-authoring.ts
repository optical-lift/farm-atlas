import "server-only";

import {
  type WorkGrammarV1Package,
  validateWorkGrammarV1,
} from "@/lib/atlas/work-grammar-v1";

/**
 * Single approved application entry boundary for NEW structured-work code.
 *
 * This still does not write canonical work. Release A6 will add the governed
 * persistence service after database mapping and missing canonical support are
 * settled. Source prose may accompany the package as evidence, but the work's
 * operational meaning must validate inside Work Grammar V1 first.
 */
export type StructuredWorkAuthoringSeed = {
  grammar: WorkGrammarV1Package;
  sourceProse?: string | null;
};

export function beginStructuredWorkAuthoring(
  seed: StructuredWorkAuthoringSeed,
): StructuredWorkAuthoringSeed {
  validateWorkGrammarV1(seed.grammar);
  return seed;
}
