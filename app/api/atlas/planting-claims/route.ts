import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import {
  getPlantingClaimCatalog,
  recordPlantingClaim,
} from "@/lib/atlas-data/planting-claims";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const farmId = new URL(request.url).searchParams.get("farmId");
  const authorized = await requireAtlasApiAccess({
    farmId,
    allowedRoles: ["owner", "manager"],
  });
  if (!authorized.ok) return authorized.response;

  try {
    const catalog = await getPlantingClaimCatalog(authorized.access);
    return NextResponse.json(
      { ok: true, catalog },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return atlasApiError(
      500,
      "planting_catalog_failed",
      "Atlas could not load planting options.",
    );
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch (error) {
    return atlasApiError(
      400,
      "invalid_json_body",
      error instanceof Error ? error.message : "Invalid Atlas request.",
    );
  }

  const farmId = typeof body.farmId === "string" ? body.farmId : null;
  const authorized = await requireAtlasApiAccess({
    farmId,
    allowedRoles: ["owner", "manager"],
  });
  if (!authorized.ok) return authorized.response;

  try {
    const result = await recordPlantingClaim(authorized.access, {
      plantedDate: body.plantedDate as string,
      cropLabel: body.cropLabel as string,
      variety: body.variety as string | null | undefined,
      plantingMethod: body.plantingMethod as string,
      amount: body.amount as number,
      unit: body.unit as string,
      objectIds: body.objectIds as string[],
      cropProfileId: body.cropProfileId as string | null | undefined,
      coverageKind: body.coverageKind as string | undefined,
      bedLengthFt: body.bedLengthFt as number | null | undefined,
      bedWidthFt: body.bedWidthFt as number | null | undefined,
      confidence: body.confidence as string | undefined,
      note: body.note as string | null | undefined,
      idempotencyKey: body.idempotencyKey as string,
    });

    return NextResponse.json(
      { ok: true, result },
      {
        status: result.replayed ? 200 : 201,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("required") ||
      message.includes("must") ||
      message.includes("invalid") ||
      message.includes("unsupported") ||
      message.includes("greater than zero")
    ) {
      return atlasApiError(400, "invalid_planting_claim", message);
    }

    return atlasApiError(
      500,
      "planting_claim_failed",
      "Atlas could not save the planting claim.",
    );
  }
}
