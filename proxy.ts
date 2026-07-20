import type { NextRequest } from "next/server";

import { updateAtlasSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateAtlasSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
