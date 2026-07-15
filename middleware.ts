import { NextRequest, NextResponse } from "next/server";
import { legacyTaskRedirectCore } from "@/lib/atlas/task-routing-core.js";

export function middleware(request: NextRequest) {
  const destination = legacyTaskRedirectCore(request.url, request.headers.get("referer"));
  return destination ? NextResponse.redirect(destination) : NextResponse.next();
}

export const config = {
  matcher: ["/task"],
};
