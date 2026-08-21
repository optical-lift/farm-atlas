import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const weed = readFileSync("app/owner/task-card-lab/WeedCardSpecimen.tsx", "utf8");
const remaining = readFileSync("app/owner/task-card-lab/RemainingDominionCardSpecimens.tsx", "utf8");
const moveStyles = readFileSync("app/owner/task-card-lab/remaining-dominion-card-specimens.module.css", "utf8");
const frame = readFileSync("components/atlas/task-card-frame.tsx", "utf8");
const editorFrame = readFileSync("app/owner/task-card-lab/DominionCardFrame.tsx", "utf8");
const editor = readFileSync("app/owner/task-card-lab/page.tsx", "utf8");

test("Irrigation and Germination are crop-cycle variants rather than standalone gallery families", () => {
  assert.match(weed, /function CropCycleBedCard/);
  assert.match(weed, /function IrrigationCard/);
  assert.match(weed, /function GerminationCard/);
  assert.match(weed, /Same crop-cycle bed shell · irrigation care pulse/);
  assert.match(weed, /Same crop-cycle bed shell · germination logging/);
  assert.doesNotMatch(editor, /Water \/ Care/);
  assert.doesNotMatch(editor, /"Check"/);
  assert.doesNotMatch(editor, /WaterCareCardSpecimen|CheckCardSpecimen/);
});

test("shared card shell keeps the approved header and default completion while allowing logging overrides", () => {
  assert.match(editorFrame, /@\/components\/atlas\/task-card-frame/);
  assert.match(frame, /subtitle\?: string/);
  assert.match(frame, /className=\{styles\.subtitle\}/);
  assert.match(frame, /completion\?: ReactNode \| false/);
  assert.match(frame, />Done<\/button>/);
  assert.match(frame, />Unfinished<\/button>/);
});

test("Irrigation remains attached to the same bed crop and Trail", () => {
  assert.match(weed, /family="Irrigation"/);
  assert.match(weed, /title="Field Row 13"/);
  assert.match(weed, /subtitle="Field Rows"/);
  assert.match(weed, /ProCut Orange sunflower/);
  assert.match(weed, /Irrigate/);
  assert.match(weed, /care pulse/);
  assert.match(weed, /Hose line/);
  assert.match(weed, /Field Rows hose line/);
  assert.match(weed, /Evenly moist/);
  assert.doesNotMatch(weed, /Water \/ Care/);
});

test("Germination uses the same bed shell and its observation log completes the task", () => {
  assert.match(weed, /family="Germination"/);
  assert.doesNotMatch(weed, /family="Check"/);
  assert.match(weed, /Did enough emerge to keep this planting\?/);
  assert.match(weed, /Strong: "Continue"/);
  assert.match(weed, /Patchy: "Gap fill"/);
  assert.match(weed, /Failed: "Restart"/);
  assert.match(weed, /"Too early to tell": "Wait"/);
  assert.match(weed, /completion=\{completion\}/);
  assert.match(weed, /BedMap cropLabel="ProCut Orange sunflower"/);
});

test("Transplant and Divide use one crop-move shell with crop lifecycle and inline issue logging", () => {
  assert.match(editor, /TransplantCardSpecimen/);
  assert.match(remaining, /function CropMoveCard/);
  assert.match(remaining, /family="Transplant"/);
  assert.match(remaining, /family="Divide"/);
  assert.match(remaining, /title="Transplant 15 Zinnias"/);
  assert.match(remaining, /subtitle="Curve Garden"/);
  assert.match(remaining, /Seeded/);
  assert.match(remaining, /Hardened/);
  assert.match(remaining, /Pinch/);
  assert.match(remaining, /Harvest/);
  assert.match(remaining, /Grow Room/);
  assert.match(remaining, /Shelf ID/);
  assert.match(remaining, /Tray slot/);
  assert.doesNotMatch(remaining, /Water immediately/);
  assert.match(moveStyles, /\.issueDrawer\[open\][\s\S]*grid-column: 1 \/ -1/);
  assert.doesNotMatch(moveStyles.match(/\.issuePanel \{([\s\S]*?)\n\}/)?.[1] ?? "", /position:\s*absolute/);
});

test("crop-cycle specimens remain fixture-only", () => {
  assert.doesNotMatch(weed, /fetch\s*\(/);
  assert.doesNotMatch(weed, /supabase/i);
  assert.doesNotMatch(remaining, /fetch\s*\(/);
  assert.doesNotMatch(remaining, /supabase/i);
});
