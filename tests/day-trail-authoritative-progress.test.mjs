import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL(
  "../components/atlas/day-trail-summary.tsx",
  import.meta.url,
);

test("day progress uses the exact Day collection rendered by its caller", async () => {
  const source = await readFile(componentPath, "utf8");

  assert.match(source, /^"use client";/);
  assert.doesNotMatch(source, /\/api\/atlas\/living-day-plan\?date=/);
  assert.doesNotMatch(source, /body\.plan\.resolvedCount|body\.plan\.denominator/);
  assert.doesNotMatch(source, /authoritative/);
  assert.match(source, /const safeTotal = Math\.max\(0, total\)/);
  assert.match(source, /const safeCompleted = Math\.max\(0, Math\.min\(completed, safeTotal\)\)/);
  assert.match(source, /`\$\{safeCompleted\} of \$\{safeTotal\} finished`/);
});
