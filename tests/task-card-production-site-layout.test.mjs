import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const detail = read("components/atlas/site-layout-task-detail.tsx");
const migration = read("supabase/migrations/20260821140500_setup_stake_string_action_requirements_v1.sql");

test("only canonical site_layout work enters the production Setup family", () => {
  assert.match(canonical, /function isSiteLayoutTask\(task: AtlasTaskCard\)/);
  assert.match(canonical, /return task\.task_type === "site_layout"/);
  assert.match(canonical, /loadSiteLayoutRecipe/);
  assert.match(canonical, /recipeLabel=\{recipe\.label\}/);
  assert.match(canonical, /recipeTools=\{recipe\.tools\}/);
});

test("Setup is a standalone Task Card Editor family rather than an old generic task wrapper", () => {
  assert.match(detail, /AtlasTaskCardFrame/);
  assert.match(detail, /family="Setup"/);
  assert.match(detail, /data-atlas-site-layout-card="true"/);
  assert.match(detail, /data-atlas-setup-display="task-card-lab-v2"/);
  assert.doesNotMatch(detail, /WorkerReadyAssignedTaskExecutionShell/);
  assert.doesNotMatch(detail, /TaskExecutionBrief/);
  assert.doesNotMatch(detail, /atlas-phone-top|atlas-phone-brand|atlas-note-plus/);
});

test("Setup mockup grammar puts real place and dimensions in the subtitle and tools in flat Editor rows", () => {
  assert.match(detail, /metadata\.display_subject/);
  assert.match(detail, /metadata\.display_detail/);
  assert.match(detail, /const subtitle = \[subject, detail\]/);
  assert.match(detail, /<header><span>Tools<\/span><\/header>/);
  assert.match(detail, /atlas-setup-tool-rows/);
  assert.match(detail, /atlas-setup-tool-row/);
  assert.match(detail, /padding:14px 18px 9px/);
  assert.match(detail, /letter-spacing:\.15em/);
  assert.match(detail, /min-height:46px/);
  assert.doesNotMatch(detail, /timing=\{/);
  assert.doesNotMatch(detail, /metadata\.execution_how/);
  assert.doesNotMatch(detail, /metadata\.layout_dimensions/);
  assert.doesNotMatch(detail, />Steps</);
  assert.doesNotMatch(detail, /Bed width/);
  assert.doesNotMatch(detail, /Walkway width/);
  assert.doesNotMatch(detail, /Tools \+ materials/);
});

test("Setup uses the canonical Task Card frame finish controls instead of a Setup-only footer fork", () => {
  assert.match(detail, /onDone=\{\(\) => void transition\("done"\)\}/);
  assert.match(detail, /onUnfinished=\{\(\) => setUnfinishedOpen/);
  assert.match(detail, /completionDisabled=\{saving\}/);
  assert.doesNotMatch(detail, /atlas-setup-finish-buttons/);
  assert.doesNotMatch(detail, /className="primary"/);
});

test("Setup tools come from the canonical action recipe instead of specimen strings embedded in the component", () => {
  assert.match(canonical, /action_requirement_templates/);
  assert.match(canonical, /required_resource_keys/);
  assert.match(canonical, /\.from\("resources"\)/);
  assert.doesNotMatch(detail, /["'`](?:Wooden stakes|String|Scissors|Measuring tape)["'`]/);
  assert.match(migration, /measure_stake_string_v1/);
  assert.match(migration, /Stake \+ String Beds/);
  assert.match(migration, /wooden_layout_stakes/);
  assert.match(migration, /layout_string/);
  assert.match(migration, /layout_scissors/);
  assert.match(migration, /layout_measuring_tape/);
});

test("Setup keeps canonical readiness gating and canonical task transitions", () => {
  assert.match(detail, /initialReadiness\.executable === true/);
  assert.match(detail, /initialReadiness\.presentation/);
  assert.match(detail, /postAtlasTaskTransition/);
  assert.match(detail, /transition: outcome/);
  assert.match(detail, /transition\("done"\)/);
  assert.match(detail, /Partly done/);
  assert.match(detail, /Problem found/);
});
