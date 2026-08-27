import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const shell = read("components/atlas/assigned-task-execution-shell.tsx");
const instrumentPaths = [
  "components/atlas/contractor-service-task-detail.tsx",
  "components/atlas/decision-selector-task-detail.tsx",
  "components/atlas/transplant-readiness-task-detail.tsx",
  "components/atlas/buyer-outreach-task-detail.tsx",
  "components/atlas/network-outreach-task-detail.tsx",
  "components/atlas/network-inputs-task-detail.tsx",
  "components/atlas/phone-outreach-task-detail.tsx",
];

test("the universal result-instrument context carries one canonical completion capability", () => {
  assert.match(shell, /completion: AtlasTaskCompletionCapability/);
  assert.match(shell, /completion: completionCapability/);
  assert.match(shell, /resultInstrument\(resultInstrumentContext\)/);
});

test("shell-mounted terminal result actions consume the canonical capability instead of reinterpreting Task Move", () => {
  for (const path of instrumentPaths) {
    const source = read(path);
    assert.match(
      source,
      /(?:context\.)?completion\.canComplete/,
      `${path} must consume the shared completion capability`,
    );
    assert.doesNotMatch(
      source,
      /(?:context\.)?assembly\.readiness\.status\s*===\s*["']blocked["']/,
      `${path} must not reconstruct blocked readiness from Task Move`,
    );
    assert.doesNotMatch(
      source,
      /(?:context\.)?assembly\.spine\.connection\s*===\s*["']stops_at_move["']/,
      `${path} must not reconstruct stops-at-move completion policy`,
    );
  }
});

test("completion eligibility gates terminal actions without trapping nonterminal exits", () => {
  const contractor = read("components/atlas/contractor-service-task-detail.tsx");
  const decision = read("components/atlas/decision-selector-task-detail.tsx");
  const transplant = read("components/atlas/transplant-readiness-task-detail.tsx");
  const networkOutreach = read("components/atlas/network-outreach-task-detail.tsx");
  const networkInputs = read("components/atlas/network-inputs-task-detail.tsx");
  const phoneOutreach = read("components/atlas/phone-outreach-task-detail.tsx");

  assert.match(contractor, /const completionBlocked = busy \|\| !completion\.canComplete/);
  assert.match(contractor, /className=\{styles\.notYet\}[\s\S]*?disabled=\{Boolean\(saving\) \|\| busy\}/);

  assert.match(decision, /const inputBusy = saving \|\| busy/);
  assert.match(decision, /disabled=\{!selected \|\| inputBusy \|\| completionBlocked\}/);

  assert.match(transplant, /const completionBlocked = !context\.completion\.canComplete/);
  assert.match(transplant, /disabled=\{busy \|\| completionBlocked\}/);

  for (const source of [networkOutreach, networkInputs, phoneOutreach]) {
    assert.match(source, /className="unfinished" disabled=\{resultBusy\}/);
    assert.match(source, /!context\.completion\.canComplete/);
  }
});
