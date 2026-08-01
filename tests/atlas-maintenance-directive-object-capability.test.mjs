import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");

test("object context exposes Weed and governed Mowing capabilities", () => {
  assert.match(core, /'capabilities'/);
  assert.match(core, /'weed', v_object\.object_type not in/);
  assert.match(core, /'mow', v_mowing_state\.id is not null/);
});
