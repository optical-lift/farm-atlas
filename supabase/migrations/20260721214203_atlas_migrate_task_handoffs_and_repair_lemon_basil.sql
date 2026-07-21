-- Reclassify all known cascade/readiness tasks as downstream handoffs.
update atlas.tasks
set parent_task_id = null,
    generated_from = case when generated_from in ('cascade_trigger','readiness_gate') then 'workflow_handoff' else generated_from end,
    metadata = (coalesce(metadata, '{}'::jsonb)
      - 'parent_task_id'
      - 'cascade_trigger'
      - 'trigger_on_parent_status')
      || jsonb_build_object(
        'relationship_kind', case when generated_from = 'readiness_gate' then 'readiness_gate' else 'downstream' end,
        'workflow_migrated_at', now()
      ),
    updated_at = now()
where farm_id = '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid
  and (
    generated_from in ('cascade_trigger','readiness_gate')
    or metadata ? 'trigger_on_parent_status'
    or lower(coalesce(metadata ->> 'cascade_trigger','false')) in ('true','yes','1')
  );

-- Create readiness checks for biological gates that must not be inferred from starting work.
with source as (
  select t.*
  from atlas.tasks t
  where t.id = '4aab1714-b46d-4794-8083-b6890f41c544'::uuid
),
target as (
  select t.*
  from atlas.tasks t
  where t.id = 'ff0e84d0-2527-44ca-a6d2-df03708aa622'::uuid
)
insert into atlas.tasks (
  farm_id, zone_id, title, task_type, status, priority, due_date,
  unlock_text, blocker_text, generated_from, generated_from_id, note,
  metadata, action_key, work_class, task_series_key, engine_instance_key,
  assigned_membership_id, visibility_scope, updated_at
)
select
  source.farm_id,
  target.zone_id,
  'Confirm lemon basil cuttings are rooted enough to plant',
  'propagation_readiness',
  'blocked',
  'normal',
  null,
  'When roots are adequate, Atlas opens the Field Rows 2 and 3 transplant task.',
  'Waiting for the rooting interval to begin.',
  'workflow_handoff',
  source.id,
  'Mark Done only when the cuttings have usable roots. If they are not ready, choose Unfinished or reschedule the check.',
  jsonb_build_object(
    'task_key', 'lemon_basil_root_readiness_20260728',
    'relationship_kind', 'readiness_gate',
    'source_task_id', source.id,
    'downstream_task_id', target.id,
    'assigned_to', 'Anna',
    'work_rhythm', 'Propagation',
    'display_action', 'Check roots',
    'display_subject', 'Lemon basil cuttings',
    'display_detail', 'Usable roots for transplanting',
    'collection_zone', 'Grow Room'
  ),
  'check',
  'light',
  'lemon_basil_propagation_2026',
  'workflow:lemon-basil-root-readiness:2026-07-28',
  coalesce(target.assigned_membership_id, source.assigned_membership_id),
  coalesce(target.visibility_scope, source.visibility_scope, 'assigned_worker'),
  now()
from source, target
where not exists (
  select 1 from atlas.tasks existing
  where existing.farm_id = source.farm_id
    and existing.engine_instance_key = 'workflow:lemon-basil-root-readiness:2026-07-28'
);

with source as (
  select * from atlas.tasks where id='80d3cdb7-a569-43c6-ad1b-6bca58ac8647'::uuid
),
target as (
  select * from atlas.tasks where id='42ac00c9-74ab-4dcc-b5ad-385d6e876cef'::uuid
)
insert into atlas.tasks (
  farm_id, zone_id, title, task_type, status, priority, due_date,
  unlock_text, blocker_text, generated_from, generated_from_id, note,
  metadata, action_key, work_class, task_series_key, engine_instance_key,
  assigned_membership_id, visibility_scope, updated_at
)
select source.farm_id, target.zone_id,
  'Confirm Chantilly White snapdragons are ready to plant out',
  'transplant_readiness', 'blocked', 'normal', null,
  'When seedlings are rooted, sturdy, and hardened, Atlas opens the planting task.',
  'Waiting for the seed-starting task to be completed.',
  'workflow_handoff', source.id,
  'Mark Done only after rooted, sturdy, hardened seedlings are confirmed.',
  jsonb_build_object(
    'task_key','chantilly_white_transplant_readiness_20270813',
    'relationship_kind','readiness_gate',
    'source_task_id',source.id,
    'downstream_task_id',target.id,
    'assigned_to','Anna',
    'work_rhythm','Transplant Readiness',
    'display_action','Check readiness',
    'display_subject','Chantilly White snapdragons',
    'display_detail','Rooted · sturdy · hardened',
    'collection_zone','Grow Room'
  ),
  'check','light','chantilly_white_2027',
  'workflow:chantilly-white-transplant-readiness:2027-08-13',
  coalesce(target.assigned_membership_id, source.assigned_membership_id),
  coalesce(target.visibility_scope, source.visibility_scope, 'assigned_worker'),
  now()
from source,target
where not exists (
  select 1 from atlas.tasks existing
  where existing.farm_id=source.farm_id
    and existing.engine_instance_key='workflow:chantilly-white-transplant-readiness:2027-08-13'
);

with source as (
  select * from atlas.tasks where id='5a38a5d6-83bb-40c9-b262-0fa7755b2577'::uuid
),
target as (
  select * from atlas.tasks where id='5c403966-8af7-4b31-abee-b12f7e1154b5'::uuid
)
insert into atlas.tasks (
  farm_id, zone_id, title, task_type, status, priority, due_date,
  unlock_text, blocker_text, generated_from, generated_from_id, note,
  metadata, action_key, work_class, task_series_key, engine_instance_key,
  assigned_membership_id, visibility_scope, updated_at
)
select source.farm_id, target.zone_id,
  'Confirm Crane White ornamental kale is ready to plant out',
  'transplant_readiness', 'blocked', 'normal', null,
  'When seedlings are rooted, sturdy, and hardened, Atlas opens the planting task.',
  'Waiting for the seed-starting task to be completed.',
  'workflow_handoff', source.id,
  'Mark Done only after rooted, sturdy, hardened seedlings are confirmed.',
  jsonb_build_object(
    'task_key','crane_white_kale_transplant_readiness_20270813',
    'relationship_kind','readiness_gate',
    'source_task_id',source.id,
    'downstream_task_id',target.id,
    'assigned_to','Anna',
    'work_rhythm','Transplant Readiness',
    'display_action','Check readiness',
    'display_subject','Crane White ornamental kale',
    'display_detail','Rooted · sturdy · hardened',
    'collection_zone','Grow Room'
  ),
  'check','light','crane_white_kale_2027',
  'workflow:crane-white-kale-transplant-readiness:2027-08-13',
  coalesce(target.assigned_membership_id, source.assigned_membership_id),
  coalesce(target.visibility_scope, source.visibility_scope, 'assigned_worker'),
  now()
from source,target
where not exists (
  select 1 from atlas.tasks existing
  where existing.farm_id=source.farm_id
    and existing.engine_instance_key='workflow:crane-white-kale-transplant-readiness:2027-08-13'
);

-- Existing concrete task-to-task handoffs.
insert into atlas.workflow_handoffs (
  farm_id, stable_key, source_kind, source_id, source_event,
  target_task_id, effect, target_date, metadata
)
select source.farm_id, spec.stable_key, 'task', source.id, 'done',
       target.id, spec.effect, spec.target_date,
       jsonb_build_object(
         'transition_note', spec.transition_note,
         'transition_reason', spec.transition_reason,
         'mark_source_ready', spec.mark_source_ready,
         'migration', 'atlas_unified_workflow_handoffs_v1'
       )
from (
  values
    ('clear-fr9-to-sow-fr9','01cd5a55-33db-4300-bf7d-fb26cd80c891'::uuid,'91313860-93cc-4ca4-b4aa-cd0d761821f7'::uuid,'schedule_task','2026-08-20'::date,true,'Field Row 9 is cleared; pollenless sunflower sowing is now available.','Bed-clearing prerequisite was completed.'),
    ('clear-fr10-to-sow-fr10','8a5f8a65-97eb-4169-b1f0-99632f5c5190'::uuid,'4dee46a2-762e-4a5b-9089-b5ae700d7c4e'::uuid,'schedule_task','2026-08-21'::date,true,'Field Row 10 is cleared; pollenless sunflower sowing is now available.','Bed-clearing prerequisite was completed.'),
    ('purchase-chantilly-to-start','51b9cf35-91b5-4874-800a-f6a6beb3bb90'::uuid,'80d3cdb7-a569-43c6-ad1b-6bca58ac8647'::uuid,'schedule_task','2027-05-28'::date,true,'Chantilly White seed is available; seed starting is now scheduled.','Seed-purchase prerequisite was completed.'),
    ('purchase-crane-kale-to-start','08570751-5d17-4b1f-8b6b-6beecdcd107c'::uuid,'5a38a5d6-83bb-40c9-b262-0fa7755b2577'::uuid,'schedule_task','2027-07-02'::date,true,'Crane White kale seed is available; seed starting is now scheduled.','Seed-purchase prerequisite was completed.'),
    ('grow-room-basil-readiness-to-transplant','111af7b8-c4b6-4db1-be30-c2fc20470e20'::uuid,'7e61ae50-e01a-4b42-ab05-e9495abb5faa'::uuid,'open_task',null::date,true,'Grow-room basil is confirmed ready; the transplant task is available.','Readiness check was completed.')
) as spec(stable_key,source_id,target_id,effect,target_date,mark_source_ready,transition_note,transition_reason)
join atlas.tasks source on source.id=spec.source_id
join atlas.tasks target on target.id=spec.target_id
on conflict (farm_id, stable_key) do update
set source_id=excluded.source_id,
    source_event=excluded.source_event,
    target_task_id=excluded.target_task_id,
    effect=excluded.effect,
    target_date=excluded.target_date,
    metadata=excluded.metadata,
    active=true,
    satisfied_at=null,
    satisfied_by_event_id=null,
    updated_at=now();

-- Biological chains use explicit readiness checks.
insert into atlas.workflow_handoffs (
  farm_id, stable_key, source_kind, source_id, source_event,
  target_task_id, effect, target_date, metadata
)
select source.farm_id, spec.stable_key, 'task', source.id, 'done',
       target.id, 'schedule_task', spec.target_date,
       jsonb_build_object(
         'transition_note', spec.transition_note,
         'transition_reason', spec.transition_reason,
         'mark_source_ready', spec.mark_source_ready,
         'migration', 'atlas_unified_workflow_handoffs_v1'
       )
from (
  values
    ('lemon-cuttings-to-root-check','4aab1714-b46d-4794-8083-b6890f41c544'::uuid,'workflow:lemon-basil-root-readiness:2026-07-28','2026-07-28'::date,false,'The rooting check is now scheduled.','Cuttings were placed in water.'),
    ('lemon-root-check-to-transplant',null::uuid,'ff0e84d0-2527-44ca-a6d2-df03708aa622'::text,'2026-08-03'::date,true,'Lemon basil cuttings are rooted; planting is now scheduled.','Root-readiness check was completed.'),
    ('chantilly-start-to-readiness','80d3cdb7-a569-43c6-ad1b-6bca58ac8647'::uuid,'workflow:chantilly-white-transplant-readiness:2027-08-13','2027-08-13'::date,false,'The Chantilly White transplant-readiness check is scheduled.','Seed starting was completed.'),
    ('chantilly-readiness-to-plant',null::uuid,'42ac00c9-74ab-4dcc-b5ad-385d6e876cef'::text,'2027-08-20'::date,true,'Chantilly White seedlings are ready; planting is now scheduled.','Transplant readiness was confirmed.'),
    ('crane-kale-start-to-readiness','5a38a5d6-83bb-40c9-b262-0fa7755b2577'::uuid,'workflow:crane-white-kale-transplant-readiness:2027-08-13','2027-08-13'::date,false,'The Crane White kale transplant-readiness check is scheduled.','Seed starting was completed.'),
    ('crane-kale-readiness-to-plant',null::uuid,'5c403966-8af7-4b31-abee-b12f7e1154b5'::text,'2027-08-20'::date,true,'Crane White kale seedlings are ready; planting is now scheduled.','Transplant readiness was confirmed.')
) as spec(stable_key,source_id,target_ref,target_date,mark_source_ready,transition_note,transition_reason)
join atlas.tasks target on (
  (spec.source_id is not null and target.engine_instance_key=spec.target_ref)
  or (spec.source_id is null and target.id=spec.target_ref::uuid)
)
join atlas.tasks source on source.id = coalesce(
  spec.source_id,
  case spec.stable_key
    when 'lemon-root-check-to-transplant' then (
      select id from atlas.tasks where engine_instance_key='workflow:lemon-basil-root-readiness:2026-07-28' limit 1
    )
    when 'chantilly-readiness-to-plant' then (
      select id from atlas.tasks where engine_instance_key='workflow:chantilly-white-transplant-readiness:2027-08-13' limit 1
    )
    when 'crane-kale-readiness-to-plant' then (
      select id from atlas.tasks where engine_instance_key='workflow:crane-white-kale-transplant-readiness:2027-08-13' limit 1
    )
  end
)
on conflict (farm_id, stable_key) do update
set source_id=excluded.source_id,
    source_event=excluded.source_event,
    target_task_id=excluded.target_task_id,
    effect=excluded.effect,
    target_date=excluded.target_date,
    metadata=excluded.metadata,
    active=true,
    satisfied_at=null,
    satisfied_by_event_id=null,
    updated_at=now();

-- Correct the premature lemon-basil completion without deleting its audit history.
update atlas.tasks
set due_date='2026-08-03'::date,
    metadata=(coalesce(metadata,'{}'::jsonb)
      - 'parent_task_id'
      - 'checklist_status'
      - 'checklist_completed_at'
      - 'completion_source')
      || jsonb_build_object(
        'relationship_kind','downstream',
        'requires_source_ready',true,
        'source_ready',false,
        'readiness_blocker','Cuttings must have usable roots before planting.',
        'workflow_repair_reason','Prematurely closed by parent checklist attestation; reopened as downstream work.',
        'workflow_repaired_at',now()
      ),
    updated_at=now()
where id='ff0e84d0-2527-44ca-a6d2-df03708aa622'::uuid;

select atlas.record_task_transition_v1_internal(
  'ff0e84d0-2527-44ca-a6d2-df03708aa622'::uuid,
  'checklist_open',
  'workflow-repair:lemon-basil:reopen',
  null,
  'Reopened because rooting the cuttings and planting them are separate farm actions.',
  'Corrected an invalid parent-attestation closure.',
  'workflow',
  'lemon-basil-repair',
  jsonb_build_object(
    'completion_source','workflow_repair',
    'preserve_prior_history',true
  ),
  null
);

select atlas.record_task_transition_v1_internal(
  'ff0e84d0-2527-44ca-a6d2-df03708aa622'::uuid,
  'blocked',
  'workflow-repair:lemon-basil:waiting-for-roots',
  null,
  'Waiting for usable roots before planting in Field Rows 2 and 3.',
  'Cuttings are rooting in water.',
  'workflow',
  'lemon-basil-root-readiness',
  jsonb_build_object(
    'completion_source','workflow_repair',
    'readiness_task_key','lemon_basil_root_readiness_20260728'
  ),
  null
);

-- Backfill the already-completed lemon-basil source task into the event bus.
select atlas.emit_workflow_event_v1(
  t.farm_id,
  'task',
  t.id,
  coalesce(nullif(t.engine_instance_key,''),nullif(t.task_series_key,''),nullif(t.metadata->>'task_key',''),t.id::text),
  'done',
  (t.completed_at at time zone 'America/Chicago')::date,
  'backfill:task-done:' || t.id::text || ':' || t.completed_at::text,
  jsonb_build_object(
    'backfill',true,
    'task_title',t.title,
    'migration','atlas_unified_workflow_handoffs_v1'
  )
)
from atlas.tasks t
where t.id='4aab1714-b46d-4794-8083-b6890f41c544'::uuid
  and t.status='done';

create or replace view atlas.workflow_handoff_status_v1
with (security_invoker = true)
as
select
  h.id,
  h.farm_id,
  h.stable_key,
  h.source_kind,
  h.source_id,
  h.source_key,
  h.source_event,
  h.effect,
  h.target_task_id,
  target.title as target_task_title,
  target.status as target_task_status,
  target.due_date as target_due_date,
  h.active,
  h.satisfied_at,
  h.satisfied_by_event_id,
  h.metadata,
  h.created_at,
  h.updated_at
from atlas.workflow_handoffs h
left join atlas.tasks target on target.id=h.target_task_id;

revoke all on atlas.workflow_handoff_status_v1 from public, anon, authenticated;
grant select on atlas.workflow_handoff_status_v1 to service_role;

revoke all on function atlas.apply_workflow_event_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.emit_workflow_event_v1(uuid,text,uuid,text,text,date,text,jsonb) from public, anon, authenticated;
revoke all on function atlas.emit_task_outcome_workflow_event_v1() from public, anon, authenticated;
revoke all on function atlas.emit_object_activity_workflow_event_v1() from public, anon, authenticated;
revoke all on function atlas.emit_maintenance_workflow_event_v1() from public, anon, authenticated;
revoke all on function atlas.emit_field_log_workflow_event_v1() from public, anon, authenticated;
revoke all on function atlas.emit_crop_cycle_workflow_event_v1() from public, anon, authenticated;
revoke all on function atlas.emit_production_succession_workflow_event_v1() from public, anon, authenticated;
revoke all on function atlas.guard_downstream_task_not_checklist_child_v1() from public, anon, authenticated;

comment on table atlas.workflow_events is
  'Append-only operational events emitted by task, object, maintenance, crop-cycle, production, and field-log systems.';
comment on table atlas.workflow_handoffs is
  'Idempotent rules that open or schedule downstream work after a recorded operational event. Handoffs never silently complete target tasks.';
comment on function atlas.apply_workflow_event_v1(uuid) is
  'Applies matching workflow handoffs through the canonical task transition engine; target completion is intentionally unsupported.';
