import Link from "next/link";

import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type LineageRow = {
  id: string;
  stable_key: string;
  lineage_name: string;
  common_name: string;
  botanical_name: string | null;
  source_name: string | null;
  source_type: string | null;
  origin_year: number | null;
  origin_detail: string | null;
  story: string;
  legacy_status: string[] | null;
  propagation_goal: string | null;
  metadata: Record<string, unknown> | null;
  plant_instances: Array<{ count: number }> | null;
  propagation_events: Array<{ count: number }> | null;
};

function sourceLabel(row: LineageRow) {
  const parts = [row.source_name, row.origin_year ? String(row.origin_year) : null].filter(Boolean);
  return parts.join(" · ") || "Origin not yet recorded";
}

function isMemorial(row: LineageRow) {
  return (row.legacy_status ?? []).some((status) => status.toLowerCase().includes("memorial"));
}

export default async function LivingLineagesPage() {
  const { data: farm } = await atlasSupabase
    .schema("atlas")
    .from("farms")
    .select("id")
    .eq("stable_key", "elm_farm")
    .single();

  const { data, error } = farm
    ? await atlasSupabase
        .schema("atlas")
        .from("plant_lineages")
        .select("id, stable_key, lineage_name, common_name, botanical_name, source_name, source_type, origin_year, origin_detail, story, legacy_status, propagation_goal, metadata, plant_instances(count), propagation_events(count)")
        .eq("farm_id", farm.id)
        .eq("active", true)
        .order("lineage_name", { ascending: true })
    : { data: [], error: new Error("Elm Farm was not found.") };

  const lineages = (data ?? []) as LineageRow[];

  return (
    <main style={{ minHeight: "100vh", background: "#f5f0e8", color: "#2e2932", padding: "18px 14px 48px" }}>
      <div style={{ width: "min(760px, 100%)", margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18 }}>
          <div>
            <span style={{ display: "block", color: "#76558f", fontSize: 12, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>Elm Farm</span>
            <h1 style={{ margin: "4px 0 0", fontSize: 30, lineHeight: 1.05 }}>Living Lineages</h1>
          </div>
          <Link href="/" style={{ color: "#65477c", fontWeight: 800, textDecoration: "none", background: "#fff", borderRadius: 999, padding: "10px 14px", boxShadow: "0 4px 18px rgba(54,35,66,.08)" }}>
            Atlas home
          </Link>
        </header>

        <section style={{ background: "linear-gradient(145deg,#6f4f87,#49365d)", color: "white", borderRadius: 26, padding: 20, marginBottom: 16, boxShadow: "0 14px 34px rgba(62,40,77,.22)" }}>
          <p style={{ margin: 0, opacity: .82, fontSize: 13, fontWeight: 700 }}>Plants carry their people, origin, and propagation history.</p>
          <strong style={{ display: "block", fontSize: 26, marginTop: 8 }}>{lineages.length} founding lineages</strong>
          <span style={{ display: "block", marginTop: 6, opacity: .8, fontSize: 13 }}>Every future division can remain connected to its parent plant and permanent story.</span>
        </section>

        {error ? (
          <p style={{ background: "#fff1ef", borderRadius: 18, padding: 16 }}>Living Lineages could not load: {error.message}</p>
        ) : null}

        <div style={{ display: "grid", gap: 12 }}>
          {lineages.map((lineage) => {
            const instanceCount = lineage.plant_instances?.[0]?.count ?? 0;
            const eventCount = lineage.propagation_events?.[0]?.count ?? 0;
            return (
              <article key={lineage.id} style={{ background: "rgba(255,255,255,.94)", borderRadius: 22, padding: 17, boxShadow: "0 7px 24px rgba(70,53,78,.08)", border: isMemorial(lineage) ? "1px solid #d8bd70" : "1px solid rgba(94,76,104,.08)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <span style={{ color: "#76558f", fontSize: 12, fontWeight: 800 }}>{lineage.common_name}</span>
                    <h2 style={{ margin: "3px 0 0", fontSize: 21 }}>{lineage.lineage_name}</h2>
                  </div>
                  <span style={{ flex: "0 0 auto", background: "#eee5f3", color: "#5d426f", borderRadius: 999, padding: "7px 10px", fontSize: 11, fontWeight: 800 }}>
                    {instanceCount} plants · {eventCount} propagations
                  </span>
                </div>

                <p style={{ margin: "12px 0 0", fontSize: 13, fontWeight: 800, color: "#6d5c70" }}>{sourceLabel(lineage)}</p>
                {lineage.origin_detail ? <p style={{ margin: "5px 0 0", color: "#766c78", fontSize: 13 }}>{lineage.origin_detail}</p> : null}
                <p style={{ margin: "13px 0 0", lineHeight: 1.55, fontSize: 15 }}>{lineage.story}</p>

                {(lineage.legacy_status ?? []).length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 13 }}>
                    {(lineage.legacy_status ?? []).map((status) => (
                      <span key={status} style={{ background: status.toLowerCase().includes("memorial") ? "#fbf1cf" : "#f1edf3", color: "#57485d", borderRadius: 999, padding: "6px 9px", fontSize: 11, fontWeight: 800 }}>{status}</span>
                    ))}
                  </div>
                ) : null}

                {lineage.propagation_goal ? (
                  <div style={{ marginTop: 13, padding: "11px 12px", borderRadius: 14, background: "#f5f0f7" }}>
                    <strong style={{ display: "block", fontSize: 11, color: "#76558f", textTransform: "uppercase", letterSpacing: ".08em" }}>Propagation goal</strong>
                    <span style={{ display: "block", marginTop: 4, lineHeight: 1.45 }}>{lineage.propagation_goal}</span>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
