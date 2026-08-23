import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const execution = read("lib/atlas/task-execution.ts");
const brief = read("components/atlas/task-execution-brief.tsx");
const networkInputs = read("components/atlas/network-inputs-task-detail.tsx");
const resultForm = read("components/atlas/structured-work-result-form.tsx");
const resultApi = read("app/api/atlas/work-result/route.ts");
const grammar = read("supabase/migrations/20260823002136_add_structured_work_execution_grammar_v1.sql");
const gateMirror = read("supabase/migrations/20260823021551_mirror_task_prerequisites_and_gate_states_into_work_components_v1.sql");
const compactTruth = read("supabase/migrations/20260823021625_retire_fake_project_trackers_and_compact_destination_truth_v1.sql");
const prosePurge = read("supabase/migrations/20260823021703_delete_duplicate_blocker_and_outreach_prompt_prose_v1.sql");
const resultContract = read("supabase/migrations/20260823021947_add_generic_work_result_contract_v1.sql");
const inputConversion = read("supabase/migrations/20260823022026_convert_network_input_notes_to_structured_results_v1.sql");

test("task notes are evidence, never fallback instructions", () => {
  assert.doesNotMatch(execution, /firstSentence\(task\.note\)/);
  assert.doesNotMatch(execution, /task\.note\?\.trim/);
  assert.match(execution, /const details = atlasMetaString\(task, "execution_details"\)/);
  assert.match(brief, /StructuredTaskExecution/);
});

test("execution grammar is nouns values and relations instead of prose", () => {
  assert.match(grammar, /create table atlas\.work_execution_components/);
  assert.match(grammar, /create table atlas\.work_execution_relations/);
  assert.match(grammar, /component_kind/);
  assert.match(grammar, /value_numeric/);
  assert.match(grammar, /relation_kind/);
  assert.match(grammar, /copy_work_execution_structure_to_task_v1/);
});

test("waiting prose is backed by real prerequisite and gate components", () => {
  assert.match(gateMirror, /'task','prerequisite'/);
  assert.match(gateMirror, /'gate:owner_confirmation'/);
  assert.match(gateMirror, /'gate:sales_inventory'/);
  assert.match(prosePurge, /blocker_authority','structured_gate_or_prerequisite_v1/);
  assert.match(prosePurge, /set blocker_text=null/);
});

test("fake project trackers retire without fabricated completion and destination gaps become state", () => {
  assert.match(compactTruth, /semantic_container_state','retired_non_executable/);
  assert.match(compactTruth, /set status='archived'/);
  assert.doesNotMatch(compactTruth, /set status='done'/);
  assert.match(compactTruth, /'state:destination','state','destination','Destination'/);
  assert.match(compactTruth, /'missing'/);
});

test("generic work outputs are typed append-only evidence", () => {
  assert.match(resultContract, /create table if not exists atlas\.work_result_fields/);
  assert.match(resultContract, /create table if not exists atlas\.work_result_submissions/);
  assert.match(resultContract, /create table if not exists atlas\.work_result_values/);
  assert.match(resultContract, /Work result history is append-only/);
  assert.match(resultContract, /record_work_result_submission_v1/);
  assert.match(resultContract, /copy_work_result_fields_to_task_v1/);
  assert.match(resultApi, /record_work_result_submission_v1/);
  assert.match(resultApi, /structured-work-result-v1/);
  assert.match(resultForm, /valueKind/);
  assert.match(resultForm, /Save source|submitLabel/);
});

test("network input research no longer stores findings in a textarea task note", () => {
  assert.match(networkInputs, /StructuredWorkResultForm/);
  assert.doesNotMatch(networkInputs, /<textarea/);
  assert.doesNotMatch(networkInputs, /transition: "note"/);
  assert.doesNotMatch(networkInputs, /inline_subtask_note/);
  assert.match(inputConversion, /'source','Source','text'/);
  assert.match(inputConversion, /'material','Material','text'/);
  assert.match(inputConversion, /'availability','Availability','choice'/);
  assert.match(inputConversion, /'result_storage','atlas\.work_result_submissions'/);
  assert.match(inputConversion, /-'network_log_prompt'/);
});
