import { NextResponse } from "next/server";

import { ANNA_WORKER_DAY_PILOT_COOKIE } from "@/lib/anna-worker-day-pilot";
import {
  ELM_WORK_SESSION_COOKIE,
  redeemElmWorkPass,
} from "@/lib/worker-work-pass";

export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const bootstrapToken = requestUrl.searchParams.get("token")?.trim();

  if (!bootstrapToken) {
    return NextResponse.redirect(new URL("/anna", requestUrl), 303);
  }

  // Do not redeem a one-time work pass on GET. Messaging clients and link-preview
  // crawlers may prefetch links before the intended worker taps them.
  const safeToken = escapeHtml(bootstrapToken);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex,nofollow,noarchive" />
    <title>Anna · Elm Farm</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f0e8; color: #292722; font-family: Georgia, "Times New Roman", serif; }
      main { width: min(32rem, calc(100vw - 3rem)); padding: 2.5rem; background: #fffdf8; border: 1px solid #d8d1c5; box-shadow: 0 12px 36px rgb(0 0 0 / 8%); }
      h1 { margin: 0 0 .65rem; font-size: 2rem; font-weight: 500; }
      p { margin: 0 0 1.5rem; line-height: 1.5; }
      button { width: 100%; border: 1px solid #292722; background: #292722; color: white; padding: .9rem 1rem; font: inherit; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>Anna's Elm Farm Atlas</h1>
      <p>Open your work page on this browser.</p>
      <form method="post" action="/anna/edit">
        <input type="hidden" name="token" value="${safeToken}" />
        <button type="submit">Open Anna's Atlas</button>
      </form>
    </main>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const formData = await request.formData();
  const bootstrapToken = String(formData.get("token") ?? "").trim();

  if (!bootstrapToken) {
    return NextResponse.redirect(new URL("/anna?edit=denied", requestUrl), 303);
  }

  const redeemed = await redeemElmWorkPass(bootstrapToken);
  if (!redeemed) {
    return NextResponse.redirect(new URL("/anna?edit=denied", requestUrl), 303);
  }

  const response = NextResponse.redirect(
    new URL(redeemed.destination, requestUrl),
    303,
  );
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    expires: redeemed.expiresAt,
  };

  // Worker Day now reads the general Elm work session. Keep the legacy pilot
  // cookie during the transition because its edit-state helper still recognizes it.
  response.cookies.set(
    ELM_WORK_SESSION_COOKIE,
    redeemed.sessionToken,
    cookieOptions,
  );
  response.cookies.set(
    ANNA_WORKER_DAY_PILOT_COOKIE,
    redeemed.sessionToken,
    cookieOptions,
  );

  return response;
}
