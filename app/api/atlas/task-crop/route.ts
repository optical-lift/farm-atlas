import { NextRequest, NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type Body = {
  taskId?: string;
  cropProfileId?: string;
  cropProfileStableKey?: string;
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

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function formatNumberish(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const asText = String(value).trim();
  if (!asText) return null;
  const asNumber = Number(asText);
  return Number.isFinite(asNumber) && Number.isInteger(asNumber) ? String(asNumber) : asText;
}

function spacingLines(profile: CropProfileRow) {
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

async function findCropProfile(body: Body) {
  const cropProfileId = clean(body.cropProfileId);
  const cropProfileStableKey = clean(body.cropProfileStableKey);

  let query = atlasSupabase
    .schema("atlas")
    .from("crop_profiles")
    .select("id, stable_key, crop_label, variety, default_planting_method, rows_per_3ft_bed, in_row_spacing_in, metadata");

  if (cropProfileId) query = query.eq("id", cropProfileId);
  else if (cropProfileStableKey) query = query.eq("stable_key", cropProfileStableKey);
  else throw new Error("Crop profile is required.");

  const { data, error } = await query.single();
  if (error || !data) throw new Error(error?.message || "Crop profile was not found.");
  return data as CropProfileRow;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const taskId = clean(body.taskId);
    if (!taskId) return NextResponse.json({ ok: false, error: "Task id is required." }, { status: 400 });

    const cropProfile = await findCropProfile(body);
    const { data: task, error: taskError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .select("id, metadata")
      .eq("id", taskId)
      .single();
    if (taskError || !task) throw new Error(taskError?.message || "Task was not found.");

    const currentMetadata = ((task.metadata as JsonRecord | null) ?? {});
    const metadata: JsonRecord = {
      ...currentMetadata,
      crop_profile_id: cropProfile.id,
      crop_profile_stable_key: cropProfile.stable_key,
      crop_label: cropProfile.crop_label,
      crop_profile_variety: cropProfile.variety,
      default_planting_method: cropProfile.default_planting_method,
      plant_spacing_lines: spacingLines(cropProfile),
      plant_spacing_source: "crop_profile",
    };

    const { error: updateError } = await atlasSupabase
      .schema("atlas")
      .from("tasks")
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq("id", taskId);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true, taskId, cropProfile, spacingLines: metadata.plant_spacing_lines });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Atlas task crop failed.", details: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
