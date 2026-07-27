import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260727234500_grant_organization_session_read_v1.sql", import.meta.url),
  "utf8",
);

test("authenticated sessions can read organization identity through RLS", () => {
  assert.match(migration, /grant select on table atlas\.organization_memberships to authenticated/i);
  assert.match(migration, /grant select on table atlas\.organizations to authenticated/i);
  assert.match(migration, /revoke all on table atlas\.organization_memberships from public, anon/i);
  assert.match(migration, /revoke all on table atlas\.organizations from public, anon/i);
});
