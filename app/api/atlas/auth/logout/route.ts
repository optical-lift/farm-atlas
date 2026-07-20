import { NextResponse } from "next/server";
import { clearAtlasSession } from "@/lib/atlas-auth";

export async function POST(request: Request) {
  await clearAtlasSession();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
