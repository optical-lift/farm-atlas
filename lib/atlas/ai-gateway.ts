import "server-only";

import { callAtlasStructured } from "@/lib/atlas/model-runtime";

/**
 * Backward-compatible shim for older callers. The implementation is no longer
 * Vercel-specific; new code should import callAtlasStructured from model-runtime.
 */
export async function callAtlasGatewayStructured<T>(
  request: Request,
  name: string,
  schema: unknown,
  system: string,
  user: string,
): Promise<T> {
  return callAtlasStructured<T>(request, name, schema, system, user);
}
