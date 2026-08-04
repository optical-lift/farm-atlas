import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../app/task-focus/[taskId]/page.tsx", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260804144000_guest_readiness_focus_service_read_v1.sql",
    import.meta.url,
  ),
  "utf8",
);

test("guest readiness task focus grants its server loader the exact state read it performs", () => {
  assert.match(page, /from\("guest_readiness_room_state"\)/);
  assert.match(
    migration,
    /grant\s+select\s+on\s+table\s+atlas\.guest_readiness_room_state\s+to\s+service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant\s+(?:all|insert|update|delete)[\s\S]*guest_readiness_room_state/i,
  );
  assert.doesNotMatch(migration, /guest_readiness_room_history/i);
});
