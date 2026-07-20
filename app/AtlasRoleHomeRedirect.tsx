"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

type SessionResponse = {
  ok?: boolean;
  identity?: {
    memberships?: Array<{ role?: string; active?: boolean }>;
  } | null;
};

export default function AtlasRoleHomeRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname !== "/") return;

    let cancelled = false;

    async function routeHome() {
      try {
        const response = await fetch("/api/atlas/auth/session", {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) return;

        const data = (await response.json()) as SessionResponse;
        if (cancelled || !data.ok || !data.identity) return;

        const memberships = data.identity.memberships ?? [];
        if (memberships.some((membership) => membership.active && membership.role === "owner")) {
          router.replace("/owner");
          return;
        }

        if (memberships.some((membership) => membership.active && membership.role === "manager")) {
          router.replace("/marshall");
        }
      } catch {
        // The login middleware remains the authority when a session is unavailable.
      }
    }

    void routeHome();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
