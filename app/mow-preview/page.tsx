import { notFound } from "next/navigation";

import MowingTaskCardBody from "@/components/atlas/mowing-task-card-body";
import AtlasTaskCardFrame from "@/components/atlas/task-card-frame";
import { atlasSupabase } from "@/lib/atlas/supabase-server";
import { buildMowingCardViewModel } from "@/lib/atlas/mowing-card-view-model";
import { getAtlasSession } from "@/lib/atlas/session";

export const dynamic = "force-dynamic";

type RuleRow = {
  farm_id?: string | null;
  label?: string | null;
  applicability?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

type ObjectRow = {
  id?: string | null;
  label?: string | null;
  zone_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

type AreaRow = {
  last_mowed_at?: string | null;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()));
}

function prettyDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(date);
}

export default async function MowPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const ruleId = firstValue(query.ruleId);
  const date = firstValue(query.date);
  if (!ruleId || !/^[0-9a-f-]{36}$/i.test(ruleId) || !validDate(date)) notFound();

  const session = await getAtlasSession();
  if (!session) notFound();

  const { data: ruleData, error: ruleError } = await atlasSupabase
    .schema("atlas")
    .from("rhythm_rules")
    .select("farm_id, label, applicability, metadata")
    .eq("id", ruleId)
    .eq("rhythm_key", "mowing")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (ruleError || !ruleData) notFound();
  const rule = ruleData as RuleRow;
  const farmId = text(rule.farm_id);
  if (!farmId || !session.memberships.some((membership) => membership.farmId === farmId)) notFound();

  const objectKey = text(rule.applicability?.objectKey);
  if (!objectKey) notFound();
  const { data: objectData, error: objectError } = await atlasSupabase
    .schema("atlas")
    .from("growing_objects")
    .select("id, label, zone_id, metadata")
    .eq("farm_id", farmId)
    .eq("stable_key", objectKey)
    .limit(1)
    .maybeSingle();
  if (objectError || !objectData) notFound();
  const object = objectData as ObjectRow;

  const zoneId = text(object.zone_id);
  const [{ data: areaData }, { data: zoneData }] = await Promise.all([
    atlasSupabase.schema("atlas").from("mowing_area_state").select("last_mowed_at").eq("object_id", object.id).limit(1).maybeSingle(),
    zoneId ? atlasSupabase.schema("atlas").from("zones").select("label").eq("id", zoneId).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const area = areaData as AreaRow | null;
  const zoneLabel = text((zoneData as { label?: string | null } | null)?.label) || text(object.metadata?.zone_label) || "Elm Farm";
  const equipmentGroup = text(rule.metadata?.equipmentGroup) || text(object.metadata?.equipment_group) || null;
  const targetCutHeightInches = numberOrNull(rule.metadata?.targetCutHeightInches ?? object.metadata?.target_cut_height_inches);
  const card = buildMowingCardViewModel({
    routeLabel: text(object.label) || text(rule.label) || "Mowing route",
    zoneLabel,
    lastMowedAt: text(area?.last_mowed_at) || null,
    dueDate: date as string,
    nextCheckDate: null,
    targetCutHeightInches,
    equipmentGroup,
  });

  return (
    <main style={{ minHeight: "100%", padding: "18px 14px 120px", background: "var(--atlas-app-background,#f4efe6)" }} data-atlas-mow-preview="true">
      <div style={{ width: "min(100%,520px)", margin: "0 auto" }}>
        <AtlasTaskCardFrame
          family={card.family}
          familyDetail="Planned"
          title={card.route}
          subtitle={card.place}
          timing={`Scheduled · ${prettyDate(date as string)}`}
          completion={false}
        >
          <MowingTaskCardBody card={card} showRecurrence />
          <section style={{ margin: 18, borderRadius: 16, padding: "14px 15px", background: "rgba(174,179,212,.1)", color: "#505363" }}>
            <small style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".1em", textTransform: "uppercase", opacity: .62 }}>Planning preview</small>
            <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.45, fontWeight: 700 }}>This is the real future mowing slot. Result controls appear when Clock materializes the executable task.</p>
          </section>
        </AtlasTaskCardFrame>
      </div>
    </main>
  );
}
