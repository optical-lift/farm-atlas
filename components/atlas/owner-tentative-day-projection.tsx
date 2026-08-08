"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type TentativeItem = {
  id: string;
  title: string;
  planState: "planned" | "conditional" | "flexible" | string;
  sourceKind: "task" | "project_pull" | "queue" | "rhythm" | string;
  environment: string | null;
  expectedActiveMinutes: number | null;
  reason: string | null;
};

type ProjectionResponse = {
  ok?: boolean;
  active?: boolean;
  operatorLabel?: string;
  items?: TentativeItem[];
};

function sourceLabel(sourceKind: string) {
  if (sourceKind === "project_pull") return "Project pool";
  if (sourceKind === "queue") return "Queue";
  if (sourceKind === "rhythm") return "Rhythm";
  return "Projected task";
}

export default function OwnerTentativeDayProjection() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedDate = searchParams.get("date");
  const dateIso = pathname === "/day" && requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : null;
  const [response, setResponse] = useState<ProjectionResponse | null>(null);

  useEffect(() => {
    setResponse(null);
    if (!dateIso) return;

    const controller = new AbortController();
    void fetch(`/api/atlas/owner-day-projection?date=${encodeURIComponent(dateIso)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (request) => {
        if (!request.ok) return null;
        return await request.json() as ProjectionResponse;
      })
      .then((body) => {
        if (!controller.signal.aborted) setResponse(body?.ok ? body : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResponse(null);
      });

    return () => controller.abort();
  }, [dateIso]);

  if (!response?.active) return null;
  const operatorLabel = response.operatorLabel || "this worker";
  const items = response.items ?? [];

  return (
    <section
      data-owner-tentative-day-projection="true"
      aria-label={`Tentative work for ${operatorLabel}`}
      style={{
        marginTop: 12,
        padding: "13px 14px",
        border: "1px dashed rgba(125, 128, 172, .38)",
        borderRadius: 16,
        background: "rgba(244, 241, 250, .68)",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div>
          <span style={{ display: "block", color: "#858bb8", fontSize: 10, fontWeight: 950, letterSpacing: ".13em", textTransform: "uppercase" }}>Tentative</span>
          <strong style={{ display: "block", marginTop: 3, fontSize: 15 }}>Potential work for {operatorLabel}</strong>
        </div>
        <span style={{ fontSize: 11, fontWeight: 850, opacity: .58, whiteSpace: "nowrap" }}>Owner preview</span>
      </header>

      <p style={{ margin: "6px 0 10px", fontSize: 12, lineHeight: 1.4, opacity: .68 }}>
        Atlas is considering additional work for this day without releasing it into {operatorLabel}&apos;s hand.
      </p>

      {items.length ? (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((item) => (
            <article key={item.id} style={{ padding: "10px 11px", borderRadius: 12, background: "rgba(255,255,255,.68)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "start" }}>
                <strong style={{ fontSize: 14, lineHeight: 1.25 }}>{item.title}</strong>
                <span style={{ flex: "0 0 auto", fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".04em", opacity: .55 }}>{item.planState}</span>
              </div>
              <span style={{ display: "block", marginTop: 4, fontSize: 11, lineHeight: 1.35, opacity: .62 }}>
                {sourceLabel(item.sourceKind)}
                {item.expectedActiveMinutes ? ` · ${item.expectedActiveMinutes} min` : ""}
                {item.environment ? ` · ${item.environment}` : ""}
                {item.reason ? ` · ${item.reason}` : ""}
              </span>
            </article>
          ))}
        </div>
      ) : (
        <p style={{ margin: 0, padding: "9px 10px", borderRadius: 12, background: "rgba(255,255,255,.58)", fontSize: 12, lineHeight: 1.4, opacity: .66 }}>
          No additional tentative work fits this day right now.
        </p>
      )}
    </section>
  );
}
