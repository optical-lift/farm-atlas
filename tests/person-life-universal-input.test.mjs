import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("universal Atlas input contract admits restrained text fields", async () => {
  const source = await read("lib/atlas/input-contract.ts");

  assert.match(source, /AtlasInputPrimitive = "quantity" \| "choice" \| "text"/);
  assert.match(source, /type AtlasTextInputField/);
  assert.match(source, /primitive: "text"/);
  assert.match(source, /multiline\?: boolean/);
  assert.match(source, /rows\?: number/);
});

test("person goal capture uses the universal input renderer and preserves authority boundary", async () => {
  const [contract, page] = await Promise.all([
    read("lib/atlas/input-contracts/person-goal-live.ts"),
    read("app/owner/input/person-goal/page.tsx"),
  ]);

  assert.match(contract, /primitive: "text"/);
  assert.match(contract, /id: "goal_text"/);
  assert.match(contract, /persistence: "canonical"/);
  assert.match(contract, /planAuthorityGranted: false/);
  assert.match(contract, /taskAuthorityGranted: false/);
  assert.match(contract, /clockAuthorityGranted: false/);
  assert.match(page, /PersonAtlasInputSpread/);
  assert.match(page, /endpoint: "\/api\/atlas\/person-life"/);
  assert.match(page, /body: \{ action: "goal" \}/);
  assert.match(page, /valueMap: \{ text: "goal_text" \}/);
});

test("person body observation uses the same renderer without inventing medical or operational truth", async () => {
  const [contract, page] = await Promise.all([
    read("lib/atlas/input-contracts/person-body-observation-live.ts"),
    read("app/owner/input/body-observation/page.tsx"),
  ]);

  assert.match(contract, /id: "body_region"/);
  assert.match(contract, /id: "observation"/);
  assert.match(contract, /causeEstablished: false/);
  assert.match(contract, /diagnosisEstablished: false/);
  assert.match(contract, /actionEstablished: false/);
  assert.match(contract, /clockAuthorityGranted: false/);
  assert.match(page, /PersonAtlasInputSpread/);
  assert.match(page, /body: \{ action: "condition_observation" \}/);
  assert.match(page, /bodyRegion: "body_region"/);
  assert.match(page, /observation: "observation"/);
});

test("Personal Atlas overview links to governed instruments instead of owning bespoke forms", async () => {
  const source = await read("app/owner/life/PersonLifeCaptureClient.tsx");

  assert.match(source, /href="\/owner\/input\/person-goal"/);
  assert.match(source, /href="\/owner\/input\/body-observation"/);
  assert.doesNotMatch(source, /<form/);
  assert.doesNotMatch(source, /FormEvent/);
  assert.match(source, /Capture is evidence, not instruction/);
  assert.match(source, /has not been granted Clock authority/);
});

test("universal renderer keeps one idempotency key across a failed canonical retry", async () => {
  const source = await read("components/atlas/input/AtlasInputRenderer.tsx");

  assert.match(source, /const \[submissionKey, setSubmissionKey\]/);
  assert.match(source, /submissionKey \?\? createSubmissionKey/);
  assert.match(source, /sourceKey: nextSubmissionKey/);
  assert.match(source, /valueMap\?: Record<string, string>/);
});
