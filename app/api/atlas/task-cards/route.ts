import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type AtlasTaskCardRow = {
  farm_key: string;

  task_id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  unlock_text: string | null;
  blocker_text: string | null;
  note: string | null;
  generated_from: string | null;
  generated_from_id: string | null;
  created_at: string;
  updated_at: string;
  metadata: JsonRecord | null;

  zone_id: string | null;
  zone_key: string | null;
  zone_label: string | null;

task_logs: Array<{
  field_log_id: string;
  log_date: string;
  action_types: string[];
  summary_sentence: string;
  note: string | null;
  created_at: string;
}>;

  objects: Array<{
    object_id: string;
    object_key: string;
    object_label: string;
    object_type: string;
    object_mode: string | null;
  }>;

  resource_requirements: Array<{
    requirement_id: string;
    requirement_role: string;
    requirement_source: string;
    quantity_needed: number | null;
    unit: string | null;
    status: string;
    note: string | null;
    resource_key: string | null;
    resource_label: string | null;
    resource_type: string | null;
    resource_category: string | null;
    resource_status: string | null;
    resource_quantity: number | null;
    resource_unit: string | null;
    condition_notes: string | null;
    restock_needed: boolean | null;
  }>;

  action_templates: Array<{
    template_id: string;
    template_key: string;
    template_label: string;
    action_type: string;
    required_resource_categories: string[];
    optional_resource_categories: string[];
    required_resource_keys: string[];
    optional_resource_keys: string[];
    creates_follow_up_task_types: string[];
    hard_parts: string[];
    unlocks: string[];
    card_language: string | null;
  }>;
};

type CropProfileRow = {
  id: string;
  stable_key: string;
  crop_label: string;
  variety: string | null;
  default_planting_method: string | null;
  rows_per_3ft_bed: number | string | null;
  in_row_spacing_in: number | string | null;
  metadata: JsonRecord | null;
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function formatNumberish(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) && Number.isInteger(num) ? String(num) : text;
}

function cropSpacingLines(profile: CropProfileRow) {
  const metadata = profile.metadata ?? {};
  const explicit = stringList(metadata.spacing_lines);
  if (explicit.length) return explicit;

  const lines: string[] = [];
  const spacing = stringValue(metadata.default_in_row_spacing_label) ?? formatNumberish(profile.in_row_spacing_in)?.concat('" apart');
  const rows = stringValue(metadata.default_rows_per_bed_label) ?? formatNumberish(profile.rows_per_3ft_bed)?.concat(" rows");
  const perBed = stringValue(metadata.default_per_bed_label);

  if (spacing) lines.push(spacing);
  if (rows) lines.push(rows);
  if (perBed) lines.push(perBed);
  return lines;
}

function withCropProfile(card: AtlasTaskCardRow, profile: CropProfileRow | null) {
  if (!profile) return card;
  const current = card.metadata ?? {};
  const existingLines = stringList(current.plant_spacing_lines);
  const spacingLines = existingLines.length ? existingLines : cropSpacingLines(profile);

  return {
    ...card,
    metadata: {
      ...current,
      crop_profile_id: profile.id,
      crop_profile_stable_key: profile.stable_key,
      crop_label: profile.crop_label,
      crop_profile_variety: profile.variety,
      default_planting_method: profile.default_planting_method,
      plant_spacing_lines: spacingLines,
      plant_spacing_source: existingLines.length ? (stringValue(current.plant_spacing_source) ?? "task") : "crop_profile",
    },
  } satisfies AtlasTaskCardRow;
}

async function enrichWithCropProfiles(cards: AtlasTaskCardRow[]) {
  const cropIds = Array.from(new Set(cards.map((card) => stringValue(card.metadata?.crop_profile_id)).filter((value): value is string => Boolean(value))));
  const cropKeys = Array.from(new Set(cards.map((card) => stringValue(card.metadata?.crop_profile_stable_key)).filter((value): value is string => Boolean(value))));

  if (cropIds.length === 0 && cropKeys.length === 0) return cards;

  const profiles: CropProfileRow[] = [];

  if (cropIds.length) {
    const { data, error } = await atlasSupabase
      .schema("atlas")
      .from("crop_profiles")
      .select("id, stable_key, crop_label, variety, default_planting_method, rows_per_3ft_bed, in_row_spacing_in, metadata")
      .in("id", cropIds);
    if (error) throw error;
    profiles.push(...((data ?? []) as CropProfileRow[]));
  }

  if (cropKeys.length) {
    const { data, error } = await atlasSupabase
      .schema("atlas")
      .from("crop_profiles")
      .select("id, stable_key, crop_label, variety, default_planting_method, rows_per_3ft_bed, in_row_spacing_in, metadata")
      .in("stable_key", cropKeys);
    if (error) throw error;
    profiles.push(...((data ?? []) as CropProfileRow[]));
  }

  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const byKey = new Map(profiles.map((profile) => [profile.stable_key, profile]));

  return cards.map((card) => {
    const cropId = stringValue(card.metadata?.crop_profile_id);
    const cropKey = stringValue(card.metadata?.crop_profile_stable_key);
    return withCropProfile(card, (cropId ? byId.get(cropId) : null) ?? (cropKey ? byKey.get(cropKey) : null) ?? null);
  });
}

export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get("taskId");

  let query = atlasSupabase
    .schema("atlas")
    .from("v_task_cards")
    .select("*")
    .eq("farm_key", "elm_farm")
    .neq("status", "archived")
    .order("due_date", { ascending: true });

  if (taskId) {
    query = query.eq("task_id", taskId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Atlas task cards read failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Atlas task cards read failed.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  try {
    const taskCards = await enrichWithCropProfiles((data ?? []) as AtlasTaskCardRow[]);

    return NextResponse.json({
      ok: true,
      farmKey: "elm_farm",
      taskCards,
    });
  } catch (cropError) {
    console.error("Atlas crop profile enrichment failed:", cropError);

    return NextResponse.json(
      {
        ok: false,
        error: "Atlas crop profile enrichment failed.",
        details: cropError instanceof Error ? cropError.message : "Unknown crop profile error.",
      },
      { status: 500 },
    );
  }
}
