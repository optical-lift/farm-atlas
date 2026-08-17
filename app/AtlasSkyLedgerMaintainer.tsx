"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

type Props = {
  farmId: string | null;
  role: string | null;
};

export default function AtlasSkyLedgerMaintainer({ farmId, role }: Props) {
  const pathname = usePathname();
  const principalProjection = pathname === "/principal" || pathname.startsWith("/principal/");

  useEffect(() => {
    if (principalProjection) return;
    if (!farmId || !role || !["owner", "manager"].includes(role)) return;

    const controller = new AbortController();
    void fetch("/api/atlas/sky-refresh", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ farmId }),
      signal: controller.signal,
    }).catch(() => undefined);

    return () => controller.abort();
  }, [farmId, principalProjection, role]);

  return null;
}
