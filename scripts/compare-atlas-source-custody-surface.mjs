#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const expectedPath = process.argv[2];
const observedPath = process.argv[3];
if (!expectedPath || !observedPath) {
  console.error('usage: compare-atlas-source-custody-surface.mjs <expected.json> <observed.json>');
  process.exit(2);
}

const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
const observed = JSON.parse(fs.readFileSync(observedPath, 'utf8'));
assert.equal(expected.contractVersion, 1, 'expected surface contract version must be 1');
assert.equal(observed.contractVersion, 1, 'observed surface contract version must be 1');

const expectedFamilies = new Map(expected.families.map((row) => [row.familyKey, row]));
const observedFamilies = new Map(observed.families.map((row) => [row.familyKey, row]));
const keys = [...new Set([...expectedFamilies.keys(), ...observedFamilies.keys()])].sort();
let unresolved = 0;

for (const key of keys) {
  const exp = expectedFamilies.get(key);
  const obs = observedFamilies.get(key);
  if (!exp) {
    console.error(`UNEXPECTED_LIVE_FAMILY ${key} count=${obs?.artifactCount ?? 'unknown'} fingerprint=${obs?.fingerprintSha256 ?? 'unknown'}`);
    unresolved += 1;
    continue;
  }
  if (!obs) {
    console.error(`MISSING_LIVE_FAMILY ${key}`);
    unresolved += 1;
    continue;
  }
  if (exp.artifactCount !== obs.artifactCount || exp.fingerprintSha256 !== obs.fingerprintSha256) {
    console.error(`SURFACE_MISMATCH ${key} expected_count=${exp.artifactCount} live_count=${obs.artifactCount} expected=${exp.fingerprintSha256} live=${obs.fingerprintSha256}`);
    unresolved += 1;
    continue;
  }
  console.log(`VERIFIED_SURFACE ${key} count=${obs.artifactCount} sha256=${obs.fingerprintSha256}`);
}

console.log(`Atlas executable surface custody: families=${keys.length} unresolved=${unresolved}`);
if (unresolved > 0) process.exit(1);
