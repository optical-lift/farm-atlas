import { GET as readWorkerWeekProjection } from "../worker-week-projection/route";

export const dynamic = "force-dynamic";

/**
 * LEGACY COMPATIBILITY ROUTE.
 *
 * Worker week projection is the canonical data contract. Keep this endpoint
 * temporarily for unindexed/older clients while all known callers migrate to
 * /api/atlas/worker-week-projection.
 */
export async function GET(request: Request) {
  const response = await readWorkerWeekProjection(request);
  const headers = new Headers(response.headers);
  headers.set("X-Atlas-Compatibility-Route", "owner-week-projection");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
