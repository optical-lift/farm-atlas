import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { recordQuickLog } from "@/lib/atlas-data/quick-log";

export const dynamic = "force-dynamic";

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
  const authorized = await requireAtlasApiAccess({ farmId });
  if (!authorized.ok) return authorized.response;

  try {
    const result = await recordQuickLog(authorized.access, {
      logDate: body.logDate as string,
      actionTypes: body.actionTypes as string[],
      summarySentence: body.summarySentence as string,
      note: body.note as string | null | undefined,
      zoneIds: body.zoneIds as string[] | undefined,
      objectIds: body.objectIds as string[] | undefined,
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
      message.includes("unsupported")
    ) {
      return atlasApiError(400, "invalid_quick_log", message);
    }

    return atlasApiError(
      500,
      "quick_log_failed",
      "Atlas could not save the Quick Log.",
    );
  }
}
