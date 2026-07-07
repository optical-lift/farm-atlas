import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const isBareTaskPage =
    url.pathname === "/task" &&
    !url.searchParams.has("taskId") &&
    !url.searchParams.has("route") &&
    !url.searchParams.has("date") &&
    !url.searchParams.has("lane");

  if (isBareTaskPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/task"],
};
