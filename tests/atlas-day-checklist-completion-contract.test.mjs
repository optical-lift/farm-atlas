import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
function read(path) { return readFileSync(join(root, path), "utf8"); }

test("execution checklist tasks are normalized out of day quick-complete", () => {
  const migration = read("supabase/migrations/20260820141849_enforce_execution_checklist_quick_complete_contract_v1.sql");
  const dayPage = read("app/day/page.tsx");

  assert.match(migration, /execution_checklist_template_key/);
  assert.match(migration, /\{quick_complete_allowed\}/);
  assert.match(migration, /'false'::jsonb/);
  assert.match(migration, /before insert or update of metadata, status on atlas\.tasks/i);

  assert.match(dayPage, /meta\(task, "quick_complete_allowed"\) === false/);
  assert.match(dayPage, /!complete && requiresStructuredResult\(task\)/);
  assert.match(dayPage, /window\.location\.assign\(taskResultHref\(task, returnTo\)\)/);
});
