import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL(
  "../components/atlas/day-trail-summary.tsx",
  import.meta.url,
);

test("day progress reads the finite Living Day plan instead of visible cards alone", async () => {
  const source = await readFile(componentPath, "utf8");

  assert.match(source, /^"use client";/);
  assert.match(source, /\/api\/atlas\/living-day-plan\?date=/);
  assert.match(source, /body\.plan\.resolvedCount/);
  assert.match(source, /body\.plan\.denominator/);
  assert.match(source, /cache:\s*"no-store"/);
  assert.match(source, /authoritative\s*\?\?\s*\{\s*completed,\s*total\s*\}/);
});
