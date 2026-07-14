import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl;

  if (url.pathname === "/task" && url.searchParams.has("date")) {
    const destination = new URL("/day", request.url);
    destination.searchParams.set("date", url.searchParams.get("date") ?? "");
    return NextResponse.redirect(destination);
  }

  const taskId = url.pathname === "/task" ? url.searchParams.get("taskId") : null;
  if (taskId) {
    const destination = new URL(`/task-focus/${encodeURIComponent(taskId)}`, request.url);

    for (const [key, value] of url.searchParams.entries()) {
      if (key !== "taskId") destination.searchParams.append(key, value);
    }

    if (!destination.searchParams.has("returnTo")) {
      const referrer = request.headers.get("referer");
      if (referrer) {
        try {
          const referrerUrl = new URL(referrer);
          if (referrerUrl.origin === url.origin) {
            destination.searchParams.set("returnTo", `${referrerUrl.pathname}${referrerUrl.search}${referrerUrl.hash}`);
          }
        } catch {
          // Ignore malformed referrers.
        }
      }
    }

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
