"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

type SessionResponse = {
  ok?: boolean;
  authenticated?: boolean;
  memberships?: Array<{ role?: string; farmKey?: string | null }>;
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
        if (cancelled || !data.ok || !data.authenticated) return;

        const memberships = data.memberships ?? [];
        const elmMemberships = memberships.filter((membership) => membership.farmKey === "elm_farm");

        if (elmMemberships.some((membership) => membership.role === "owner")) {
          router.replace("/owner");
          return;
        }

        if (elmMemberships.some((membership) => membership.role === "manager")) {
          router.replace("/marshall");
        }
      } catch {
        // Login middleware remains the authority when a session is unavailable.
      }
    }

    void routeHome();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
