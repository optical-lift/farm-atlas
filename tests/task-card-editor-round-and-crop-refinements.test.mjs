import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const frame = readFileSync("app/owner/task-card-lab/DominionCardFrame.tsx", "utf8");
const weed = readFileSync("app/owner/task-card-lab/WeedCardSpecimen.tsx", "utf8");
const cropVariants = readFileSync("app/owner/task-card-lab/crop-cycle-bed-variants.module.css", "utf8");
const mow = readFileSync("app/owner/task-card-lab/MowCardSpecimen.tsx", "utf8");
const move = readFileSync("app/owner/task-card-lab/RemainingDominionCardSpecimens.tsx", "utf8");
const moveStyles = readFileSync("app/owner/task-card-lab/remaining-dominion-card-specimens.module.css", "utf8");
const farmRound = readFileSync("app/owner/task-card-lab/FarmRoundCardSpecimen.tsx", "utf8");
const page = readFileSync("app/owner/task-card-lab/page.tsx", "utf8");

test("Germination result logging is the completion action", () => {
  assert.match(frame, /completion\?: ReactNode \| false/);
  assert.match(weed, /family="Germination"/);
  assert.match(weed, /Strong/);
  assert.match(weed, /Patchy/);
  assert.match(weed, /Failed/);
  assert.match(weed, /Too early to tell/);
  assert.match(weed, /completion=\{completion\}/);
  assert.match(cropVariants, /\.germinationCompletion/);
  assert.doesNotMatch(weed, /family="Check"/);
});

test("Clear is the crop-cycle card type without redundant turnover naming", () => {
  assert.match(weed, /family="Clear"/);
  assert.match(weed, /label: "Clear", detail: "Aug 7"/);
  assert.doesNotMatch(weed, /Clear \/ Turn over/);
});

test("each Mow card receives only the resource required by that route", () => {
  assert.match(mow, /function MowVariant/);
  assert.match(mow, /title="U-Pick Walkways"[\s\S]*equipment=\{ridingMower\}/);
  assert.match(mow, /title="Field Rows Back Half"[\s\S]*equipment=\{pushMower\}/);
  assert.match(mow, /<IssueDrawer section=\{equipment\} \/>/);
  assert.doesNotMatch(mow, /equipment\.map/);
  assert.match(mow, /<strong>3 in<\/strong>/);
});

test("Transplant and Divide share one crop-move shell with dated crop trails", () => {
  assert.match(move, /function CropMoveCard/);
  assert.match(move, /family="Transplant"/);
  assert.match(move, /family="Divide"/);
  assert.match(move, /Seeded[\s\S]*Jul 10/);
  assert.match(move, /Hardened[\s\S]*Aug 13/);
  assert.match(move, /Transplant[\s\S]*Aug 20/);
  assert.match(move, /Pinch[\s\S]*Aug 27/);
  assert.match(move, /Harvest[\s\S]*Sep 24/);
  assert.match(move, /timing="5 wk 6 d since seeding"/);
  assert.match(move, /Shelf ID/);
  assert.match(move, /GR-02/);
  assert.match(move, /Tray slot/);
  assert.match(move, /B3/);
  assert.doesNotMatch(move, /Aftercare/);
  assert.doesNotMatch(move, /Water immediately/);
});

test("crop-move purple issue control opens inline instead of floating", () => {
  assert.match(move, /className=\{styles\.issueDrawer\}/);
  assert.match(moveStyles, /\.issuePanel \{[\s\S]*display: grid/);
  const issuePanelBlock = moveStyles.match(/\.issuePanel \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.doesNotMatch(issuePanelBlock, /position:\s*absolute/);
  assert.doesNotMatch(issuePanelBlock, /box-shadow/);
});

test("Farm Round consolidates recurring stewardship by physical route and auto-completes", () => {
  assert.match(page, /import FarmRoundCardSpecimen/);
  assert.match(page, /"Stewardship"/);
  assert.match(farmRound, /family="Stewardship"/);
  assert.match(farmRound, /title="Farm Round"/);
  assert.match(farmRound, /House/);
  assert.match(farmRound, /Sweep porches/);
  assert.match(farmRound, /Trash to street/);
  assert.match(farmRound, /Farmyard/);
  assert.match(farmRound, /Chicken chore/);
  assert.match(farmRound, /Gardens \+ Grounds/);
  assert.match(farmRound, /Water outdoor plants/);
  assert.match(farmRound, /completion=\{false\}/);
  assert.match(farmRound, /Round complete/);
  assert.doesNotMatch(farmRound, />Done<\/button>/);
  assert.doesNotMatch(farmRound, />Unfinished<\/button>/);
});
