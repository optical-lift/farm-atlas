import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const initialMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260817213537_reality_expression_spatial_truth_v1.sql",
    import.meta.url,
  ),
  "utf8",
);

const refinementMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260817213813_refine_spatial_supersession_evidence_v1.sql",
    import.meta.url,
  ),
  "utf8",
);

const refinedFunctionBody = refinementMigration.match(
  /create or replace function atlas\.crop_cycle_spatial_truth_v1[\s\S]*?\$function\$;/,
)?.[0];

assert.ok(refinedFunctionBody, "Refined spatial truth function body must be present");

test("Pass 1.1 remains a read-only service-internal contract", () => {
  assert.match(initialMigration, /crop_cycle_spatial_truth_v1\(p_crop_cycle_id uuid\)/);
  assert.match(initialMigration, /crop_cycle_reality_expression_v2\(p_crop_cycle_id uuid\)/);
  assert.match(refinementMigration, /stable\s+security invoker/i);
  assert.match(
    refinementMigration,
    /revoke all on function atlas\.crop_cycle_spatial_truth_v1\(uuid\) from public;/,
  );
  assert.match(
    refinementMigration,
    /revoke execute on function atlas\.crop_cycle_spatial_truth_v1\(uuid\) from anon;/,
  );
  assert.match(
    refinementMigration,
    /revoke execute on function atlas\.crop_cycle_spatial_truth_v1\(uuid\) from authenticated;/,
  );
  assert.match(
    refinementMigration,
    /grant execute on function atlas\.crop_cycle_spatial_truth_v1\(uuid\) to service_role;/,
  );

  assert.doesNotMatch(refinedFunctionBody, /\binsert\s+into\b/i);
  assert.doesNotMatch(refinedFunctionBody, /\bupdate\s+atlas\./i);
  assert.doesNotMatch(refinedFunctionBody, /\bdelete\s+from\b/i);
  assert.doesNotMatch(refinedFunctionBody, /\bperform\s+atlas\./i);
});

test("registry disposition and physical presence are not collapsed", () => {
  assert.match(refinementMigration, /'registry'/);
  assert.match(refinementMigration, /'physicalPresence'/);
  assert.match(refinementMigration, /'entry_evidenced_exit_unproven'/);
  assert.match(refinementMigration, /'physical_presence_unresolved'/);
  assert.match(refinementMigration, /'released'/);
  assert.match(refinementMigration, /'supersession_not_release'/);
  assert.match(
    refinementMigration,
    /registry supersession never implies physical release or prior physical presence/i,
  );
  assert.doesNotMatch(refinementMigration, /unknown_after_registry_supersession/);
});

test("superseded records require independent physical-entry evidence", () => {
  assert.match(refinementMigration, /crop_occupancy_evidence/);
  assert.match(
    refinementMigration,
    /e\.evidence_role in \('planting', 'observation', 'stage', 'quantity', 'placement'\)/,
  );
  assert.match(refinementMigration, /has_entry_evidence/);
  assert.match(refinementMigration, /entryEvidencedWithoutReleaseCount/);
  assert.match(refinementMigration, /physicalPresenceUnresolvedCount/);
});

test("same-object active crops are shared only with explicit disjoint cell proof", () => {
  assert.match(refinementMigration, /crop_placement_cells/);
  assert.match(
    refinementMigration,
    /v_subject_cell_count > 0 and evidence\.cell_count > 0 and evidence\.overlap_cell_count = 0/,
  );
  assert.match(
    refinementMigration,
    /when v_active_cooccupant_count = 0 then 'occupied'/,
  );
  assert.match(
    refinementMigration,
    /when v_all_active_cooccupants_disjoint then 'shared'/,
  );
  assert.match(refinementMigration, /else 'unresolved'/);
  assert.match(refinementMigration, /relation_evidence_required/);
  assert.match(
    refinementMigration,
    /relationship remains unresolved rather than being called conflict or lawful sharing/,
  );
});

test("physical release requires recorded clear or turnover evidence", () => {
  assert.match(
    refinementMigration,
    /v_cycle\.cleared_date is not null or v_cycle\.turnover_date is not null then 'released'/,
  );
  assert.match(
    refinementMigration,
    /classified\.cleared_date is not null or classified\.turnover_date is not null then 'released'/,
  );
  assert.match(refinementMigration, /'not_released_on_record'/);
});

test("planting claims distinguish missing, represented, and broken object linkage", () => {
  assert.match(refinementMigration, /v_claim_state text := 'missing'/);
  assert.match(refinementMigration, /then 'claim_record_missing'/);
  assert.match(refinementMigration, /then 'claim_object_missing'/);
  assert.match(refinementMigration, /else 'represented'/);
  assert.match(refinementMigration, /planting_claim_objects/);
});

test("unknown sub-bed extent remains explicit instead of becoming inferred geometry", () => {
  assert.match(refinementMigration, /then 'explicit_cells'/);
  assert.match(refinementMigration, /then 'placement_without_cells'/);
  assert.match(refinementMigration, /else 'unknown'/);
  assert.match(refinementMigration, /spatial_extent_unknown/);
  assert.match(
    refinementMigration,
    /Coarse object membership is preserved, but sub-object extent is not inferred/,
  );
});

test("Reality Expression v2 composes spatial truth without mutating v1", () => {
  assert.match(
    initialMigration,
    /v_base := atlas\.crop_cycle_reality_expression_v1\(p_crop_cycle_id\);/,
  );
  assert.match(
    initialMigration,
    /v_spatial := atlas\.crop_cycle_spatial_truth_v1\(p_crop_cycle_id\);/,
  );
  assert.match(initialMigration, /'contractVersion', 'crop_cycle_reality_expression_v2'/);
  assert.match(initialMigration, /'baseContractVersion'/);
  assert.match(initialMigration, /'spatialTruth'/);
  assert.match(
    initialMigration,
    /coalesce\(v_base -> 'issues', '\[\]'::jsonb\) \|\| coalesce\(v_spatial -> 'issues', '\[\]'::jsonb\)/,
  );
});
