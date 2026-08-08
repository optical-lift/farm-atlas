"use client";

import { useEffect } from "react";

type Props = {
  farmId: string | null;
  role: string | null;
};

export default function AtlasSkyLedgerMaintainer({ farmId, role }: Props) {
  useEffect(() => {
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
  }, [farmId, role]);

  return null;
}
