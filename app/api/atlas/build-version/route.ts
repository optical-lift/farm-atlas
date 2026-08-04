import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function atlasBuildVersion() {
  return process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.VERCEL_URL
    || "development";
}

export async function GET() {
  const buildVersion = atlasBuildVersion();
  return NextResponse.json({ ok: true, buildVersion }, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      "X-Atlas-Build-Version": buildVersion,
    },
  });
}
