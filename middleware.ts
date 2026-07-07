import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl;

  if (url.pathname === "/task" && url.searchParams.has("date")) {
    const destination = new URL("/day", request.url);
    destination.searchParams.set("date", url.searchParams.get("date") ?? "");
    return NextResponse.redirect(destination);
  }

  const isBareTaskPage =
    url.pathname === "/task" &&
    !url.searchParams.has("taskId") &&
    !url.searchParams.has("route") &&
    !url.searchParams.has("lane");

  if (isBareTaskPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/task"],
};
