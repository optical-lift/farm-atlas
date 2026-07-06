import { NextResponse } from "next/server";
import { atlasSupabase } from "@/lib/atlas/supabase-server";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type CropProfileRow = {
  id: string;
  stable_key: string;
  crop_label: string;
  variety: string | null;
  crop_family: string | null;
  life_cycle: string | null;
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

export async function GET() {
  const { data, error } = await atlasSupabase
    .schema("atlas")
    .from("crop_profiles")
    .select("id, stable_key, crop_label, variety, crop_family, life_cycle, default_planting_method, rows_per_3ft_bed, in_row_spacing_in, metadata")
    .order("crop_label", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: "Atlas crop profiles read failed.", details: error.message }, { status: 500 });
  }

  const cropProfiles = ((data ?? []) as CropProfileRow[]).map((profile) => ({
    ...profile,
    spacing_lines: spacingLines(profile),
  }));

  return NextResponse.json({ ok: true, cropProfiles });
}
