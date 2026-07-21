import {
  buildPlantingClaimResult,
  validatePlantingClaimInput,
} from "@/lib/atlas/planting-claim-core.js";
import type { AtlasRoleAccess } from "@/lib/atlas/role-access";
import { createAtlasServerClient } from "@/lib/supabase/server";
import { getFarmOperationalState } from "@/lib/atlas-data/operational-state";

export type PlantingClaimInput = {
  plantedDate: string;
  cropLabel: string;
  variety?: string | null;
  plantingMethod: string;
  amount: number;
  unit: string;
  objectIds: string[];
  cropProfileId?: string | null;
  coverageKind?: string;
  bedLengthFt?: number | null;
  bedWidthFt?: number | null;
  confidence?: string;
  note?: string | null;
  idempotencyKey: string;
};

export type PlantingClaimResult = ReturnType<typeof buildPlantingClaimResult>;

export type PlantingClaimCatalog = {
  farm: {
    id: string | null;
    key: string | null;
    name: string;
  };
  cropProfiles: Array<{
    id: string;
    key: string;
    cropLabel: string;
    variety: string | null;
    defaultPlantingMethod: string | null;
    germinationDays: { min: number | null; max: number | null };
    harvestWatchDays: { min: number | null; max: number | null };
    rowsPerThreeFootBed: number | null;
    inRowSpacingInches: number | null;
    clearOffsetDays: number | null;
  }>;
  zones: Array<{
    id: string | null;
    key: string | null;
    label: string;
    objects: Array<{
      id: string | null;
      key: string | null;
      label: string;
      type: string;
      lengthFt: number | null;
      widthFt: number | null;
      areaSqft: number | null;
      currentStage: string;
      cropLabel: string | null;
      decisionRequired: boolean;
    }>;
  }>;
};

type PlantingClaimResultRow = {
  planting_claim_id: string;
  field_log_id: string;
  actor_membership_id: string;
  actor_role: string;
  object_count: number | string;
  object_content_count: number | string;
  crop_cycle_count: number | string;
  expected_germination_start: string | null;
  expected_germination_end: string | null;
  expected_harvest_watch_start: string | null;
  expected_harvest_watch_end: string | null;
  expected_clear_date: string | null;
  replayed: boolean;
};

type CropProfileRow = {
  id: string;
  stable_key: string;
  crop_label: string;
  variety: string | null;
  default_planting_method: string | null;
  days_to_germination_min: number | null;
  days_to_germination_max: number | null;
  days_to_harvest_watch_min: number | null;
  days_to_harvest_watch_max: number | null;
  rows_per_3ft_bed: number | string | null;
  in_row_spacing_in: number | string | null;
  clear_offset_days: number | null;
};

function requirePlantingManagement(access: AtlasRoleAccess) {
  if (access.membership.role !== "owner" && access.membership.role !== "manager") {
    throw new Error("Owner or Manager membership required.");
  }
}

function nullableNumber(value: number | string | null) {
  if (value == null || value === "") return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

export async function getPlantingClaimCatalog(
  access: AtlasRoleAccess,
): Promise<PlantingClaimCatalog> {
  requirePlantingManagement(access);

  const [operationalState, cropProfilesResult] = await Promise.all([
    getFarmOperationalState(access),
    (async () => {
      const supabase = await createAtlasServerClient();
      return supabase
        .from("crop_profiles")
        .select(
          [
            "id",
            "stable_key",
            "crop_label",
            "variety",
            "default_planting_method",
            "days_to_germination_min",
            "days_to_germination_max",
            "days_to_harvest_watch_min",
            "days_to_harvest_watch_max",
            "rows_per_3ft_bed",
            "in_row_spacing_in",
            "clear_offset_days",
          ].join(", "),
        )
        .order("crop_label", { ascending: true })
        .order("variety", { ascending: true, nullsFirst: true });
    })(),
  ]);

  if (cropProfilesResult.error) {
    throw new Error("Atlas planting crop-profile catalog read failed.");
  }

  const cropProfiles = (cropProfilesResult.data ?? []) as unknown as CropProfileRow[];

  return {
    farm: operationalState.farm,
    cropProfiles: cropProfiles.map((profile) => ({
      id: profile.id,
      key: profile.stable_key,
      cropLabel: profile.crop_label,
      variety: profile.variety,
      defaultPlantingMethod: profile.default_planting_method,
      germinationDays: {
        min: profile.days_to_germination_min,
        max: profile.days_to_germination_max,
      },
      harvestWatchDays: {
        min: profile.days_to_harvest_watch_min,
        max: profile.days_to_harvest_watch_max,
      },
      rowsPerThreeFootBed: nullableNumber(profile.rows_per_3ft_bed),
      inRowSpacingInches: nullableNumber(profile.in_row_spacing_in),
      clearOffsetDays: profile.clear_offset_days,
    })),
    zones: operationalState.zones.map((zone) => ({
      id: zone.id,
      key: zone.key,
      label: zone.label,
      objects: zone.objects.map((object) => ({
        id: object.id,
        key: object.key,
        label: object.label,
        type: object.type,
        lengthFt: object.dimensions.lengthFt,
        widthFt: object.dimensions.widthFt,
        areaSqft: object.dimensions.areaSqft,
        currentStage: object.state.currentStage,
        cropLabel: object.crop?.label ?? null,
        decisionRequired: object.state.decisionRequired,
      })),
    })),
  };
}

export async function recordPlantingClaim(
  access: AtlasRoleAccess,
  input: PlantingClaimInput,
): Promise<PlantingClaimResult> {
  requirePlantingManagement(access);
  const validated = validatePlantingClaimInput(input);
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("record_planting_claim_v1", {
    p_farm_id: access.membership.farmId,
    p_planted_date: validated.plantedDate,
    p_crop_label: validated.cropLabel,
    p_variety: validated.variety,
    p_planting_method: validated.plantingMethod,
    p_amount: validated.amount,
    p_unit: validated.unit,
    p_object_ids: validated.objectIds,
    p_crop_profile_id: validated.cropProfileId,
    p_coverage_kind: validated.coverageKind,
    p_bed_length_ft: validated.bedLengthFt,
    p_bed_width_ft: validated.bedWidthFt,
    p_confidence: validated.confidence,
    p_note: validated.note,
    p_idempotency_key: validated.idempotencyKey,
  });

  if (error) {
    throw new Error("Atlas planting claim write failed.");
  }

  const rows = (data ?? []) as unknown as PlantingClaimResultRow[];
  const row = rows[0];
  if (!row?.planting_claim_id) {
    throw new Error("Atlas planting claim did not return a durable claim.");
  }

  return buildPlantingClaimResult(row) as PlantingClaimResult;
}
