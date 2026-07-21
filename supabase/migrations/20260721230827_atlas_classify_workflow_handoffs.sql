alter table atlas.workflow_handoffs
  add column if not exists handoff_mode text not null default 'automatic';

alter table atlas.workflow_handoffs
  drop constraint if exists workflow_handoffs_handoff_mode_check;
alter table atlas.workflow_handoffs
  add constraint workflow_handoffs_handoff_mode_check
  check (handoff_mode in (
    'automatic', 'date_window', 'readiness_confirmed', 'resource_confirmed',
    'owner_decision', 'result_dependent', 'recurring_condition'
  ));

create or replace function atlas.validate_workflow_handoff_mode_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_source atlas.tasks%rowtype;
  v_action text;
  v_task_type text;
  v_is_owner boolean := false;
  v_is_readiness boolean := false;
  v_is_resource_confirmation boolean := false;
begin
  if new.source_kind = 'task' and new.source_id is not null then
    select * into v_source
    from atlas.tasks
    where id = new.source_id and farm_id = new.farm_id;

    if v_source.id is null then
      raise exception 'Workflow handoff source task was not found in this farm.' using errcode='23503';
    end if;

    v_action := lower(coalesce(nullif(v_source.action_key,''), nullif(v_source.metadata->>'work_route',''), v_source.task_type, ''));
    v_task_type := lower(coalesce(v_source.task_type,''));
    v_is_owner := v_source.visibility_scope = 'owner'
      or lower(coalesce(v_source.metadata->>'owner_task','false')) in ('true','yes','1')
      or v_action in ('approve','approval','decide','decision','owner_decision');
    v_is_readiness := v_action in ('check','verify','readiness_check','transplant_readiness','propagation_readiness')
      or v_task_type like '%readiness%'
      or lower(coalesce(v_source.metadata->>'relationship_kind','')) = 'readiness_gate';
    v_is_resource_confirmation := v_action in ('confirm_resource','receive','inventory_check','resource_confirmation')
      or v_task_type in ('resource_confirmation','inventory_confirmation')
      or lower(coalesce(v_source.metadata->>'resource_confirmation','false')) in ('true','yes','1');
  end if;

  if new.handoff_mode = 'date_window'
     and (new.effect <> 'schedule_task' or (new.target_date is null and new.delay_days = 0)) then
    raise exception 'Date-window handoffs must schedule a task using a target date or delay.' using errcode='23514';
  end if;

  if new.handoff_mode = 'readiness_confirmed'
     and (new.source_kind <> 'task' or not v_is_readiness) then
    raise exception 'Readiness-confirmed handoffs must originate from an explicit readiness task.' using errcode='23514';
  end if;

  if new.handoff_mode = 'resource_confirmed'
     and (new.source_kind <> 'task' or not v_is_resource_confirmation) then
    raise exception 'Resource-confirmed handoffs must originate from an explicit resource confirmation task.' using errcode='23514';
  end if;

  if new.handoff_mode = 'owner_decision'
     and (new.source_kind <> 'task' or not v_is_owner) then
    raise exception 'Owner-decision handoffs must originate from an Owner decision task.' using errcode='23514';
  end if;

  if new.handoff_mode = 'result_dependent' and new.source_filter = '{}'::jsonb then
    raise exception 'Result-dependent handoffs require a non-empty source_filter.' using errcode='23514';
  end if;

  if new.handoff_mode = 'recurring_condition'
     and new.source_kind = 'task'
     and new.source_filter = '{}'::jsonb then
    raise exception 'Recurring-condition handoffs require a condition-bearing source or source_filter.' using errcode='23514';
  end if;

  return new;
end;
$$;

update atlas.workflow_handoffs
set handoff_mode = case
  when stable_key in ('chantilly-readiness-to-plant','crane-kale-readiness-to-plant','grow-room-basil-readiness-to-transplant','lemon-root-check-to-transplant') then 'readiness_confirmed'
  when stable_key in ('chantilly-start-to-readiness','crane-kale-start-to-readiness','lemon-cuttings-to-root-check') then 'date_window'
  when stable_key in ('clear-fr9-to-sow-fr9','clear-fr10-to-sow-fr10') then 'automatic'
  when stable_key in ('purchase-chantilly-to-start','purchase-crane-kale-to-start') then 'automatic'
  else handoff_mode
end,
metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
  'classification_version','workflow_handoff_modes_v1',
  'classified_at',now()
);

with purchase as (
  select * from atlas.tasks where metadata->>'task_key'='purchase_chantilly_white_snapdragon_20270115' limit 1
)
insert into atlas.tasks (
  farm_id, zone_id, title, task_type, status, priority, due_date,
  unlock_text, blocker_text, generated_from, generated_from_id, note,
  metadata, action_key, work_class, task_series_key, engine_instance_key,
  visibility_scope, assigned_membership_id, updated_at
)
select
  p.farm_id, null, 'Owner — Confirm Chantilly White snapdragon seed is in hand',
  'resource_confirmation', 'blocked', 'normal', null,
  'Confirms the purchased seed has physically arrived before Atlas schedules sowing.',
  'Waiting for the purchase task to be completed.', 'workflow_handoff', p.id, null,
  jsonb_build_object(
    'task_key','confirm_chantilly_white_snapdragon_seed_in_hand_2027',
    'owner_task',true,'anna_task',false,'assigned_to','Owner',
    'work_route','confirm_resource','work_rhythm','Owner Inventory',
    'display_action','Confirm in hand','display_subject','Chantilly White snapdragon seed',
    'display_detail','Purchased, delivered, and physically available',
    'resource_confirmation',true,'relationship_kind','resource_confirmation',
    'source_purchase_task_id',p.id
  ),
  'confirm_resource','light','chantilly_white_seed_2027',
  'workflow:confirm-chantilly-white-seed-in-hand:2027','owner',null,now()
from purchase p
where not exists (
  select 1 from atlas.tasks t where t.engine_instance_key='workflow:confirm-chantilly-white-seed-in-hand:2027'
);

with purchase as (
  select * from atlas.tasks where metadata->>'task_key'='purchase_crane_white_kale_20270115' limit 1
)
insert into atlas.tasks (
  farm_id, zone_id, title, task_type, status, priority, due_date,
  unlock_text, blocker_text, generated_from, generated_from_id, note,
  metadata, action_key, work_class, task_series_key, engine_instance_key,
  visibility_scope, assigned_membership_id, updated_at
)
select
  p.farm_id, null, 'Owner — Confirm Crane White F1 ornamental kale seed is in hand',
  'resource_confirmation', 'blocked', 'normal', null,
  'Confirms the purchased seed has physically arrived before Atlas schedules sowing.',
  'Waiting for the purchase task to be completed.', 'workflow_handoff', p.id, null,
  jsonb_build_object(
    'task_key','confirm_crane_white_kale_seed_in_hand_2027',
    'owner_task',true,'anna_task',false,'assigned_to','Owner',
    'work_route','confirm_resource','work_rhythm','Owner Inventory',
    'display_action','Confirm in hand','display_subject','Crane White F1 ornamental kale seed',
    'display_detail','Purchased, delivered, and physically available',
    'resource_confirmation',true,'relationship_kind','resource_confirmation',
    'source_purchase_task_id',p.id
  ),
  'confirm_resource','light','crane_white_kale_seed_2027',
  'workflow:confirm-crane-white-kale-seed-in-hand:2027','owner',null,now()
from purchase p
where not exists (
  select 1 from atlas.tasks t where t.engine_instance_key='workflow:confirm-crane-white-kale-seed-in-hand:2027'
);

with purchase as (
  select * from atlas.tasks where metadata->>'task_key'='purchase_chantilly_white_snapdragon_20270115' limit 1
), confirmation as (
  select * from atlas.tasks where engine_instance_key='workflow:confirm-chantilly-white-seed-in-hand:2027' limit 1
)
insert into atlas.workflow_handoffs (
  farm_id, stable_key, source_kind, source_id, source_key, source_event,
  source_filter, target_task_id, effect, target_date, delay_days, active,
  metadata, handoff_mode
)
select p.farm_id,'purchase-chantilly-to-arrival-check','task',p.id,null,'done','{}'::jsonb,
       c.id,'schedule_task',null,7,true,
       jsonb_build_object(
         'classification_reason','Purchase completion starts a delivery window; it does not prove possession.',
         'transition_note','Check whether the Chantilly White seed has arrived and is physically in hand.',
         'transition_reason','The seed purchase was completed seven days earlier.',
         'mark_source_ready',false
       ),'date_window'
from purchase p cross join confirmation c
on conflict (farm_id, stable_key) do update set
  source_id=excluded.source_id,target_task_id=excluded.target_task_id,effect=excluded.effect,
  target_date=excluded.target_date,delay_days=excluded.delay_days,active=true,
  metadata=excluded.metadata,handoff_mode=excluded.handoff_mode,updated_at=now();

with purchase as (
  select * from atlas.tasks where metadata->>'task_key'='purchase_crane_white_kale_20270115' limit 1
), confirmation as (
  select * from atlas.tasks where engine_instance_key='workflow:confirm-crane-white-kale-seed-in-hand:2027' limit 1
)
insert into atlas.workflow_handoffs (
  farm_id, stable_key, source_kind, source_id, source_key, source_event,
  source_filter, target_task_id, effect, target_date, delay_days, active,
  metadata, handoff_mode
)
select p.farm_id,'purchase-crane-kale-to-arrival-check','task',p.id,null,'done','{}'::jsonb,
       c.id,'schedule_task',null,7,true,
       jsonb_build_object(
         'classification_reason','Purchase completion starts a delivery window; it does not prove possession.',
         'transition_note','Check whether the Crane White kale seed has arrived and is physically in hand.',
         'transition_reason','The seed purchase was completed seven days earlier.',
         'mark_source_ready',false
       ),'date_window'
from purchase p cross join confirmation c
on conflict (farm_id, stable_key) do update set
  source_id=excluded.source_id,target_task_id=excluded.target_task_id,effect=excluded.effect,
  target_date=excluded.target_date,delay_days=excluded.delay_days,active=true,
  metadata=excluded.metadata,handoff_mode=excluded.handoff_mode,updated_at=now();

update atlas.workflow_handoffs wh
set source_id = c.id,
    handoff_mode='resource_confirmed',
    metadata = coalesce(wh.metadata,'{}'::jsonb) || jsonb_build_object(
      'classification_reason','Seed starting waits for explicit confirmation that seed is physically in hand.',
      'transition_reason','Seed availability was explicitly confirmed.',
      'classification_version','workflow_handoff_modes_v1'
    ),
    updated_at=now()
from atlas.tasks c
where wh.stable_key='purchase-chantilly-to-start'
  and c.engine_instance_key='workflow:confirm-chantilly-white-seed-in-hand:2027';

update atlas.workflow_handoffs wh
set source_id = c.id,
    handoff_mode='resource_confirmed',
    metadata = coalesce(wh.metadata,'{}'::jsonb) || jsonb_build_object(
      'classification_reason','Seed starting waits for explicit confirmation that seed is physically in hand.',
      'transition_reason','Seed availability was explicitly confirmed.',
      'classification_version','workflow_handoff_modes_v1'
    ),
    updated_at=now()
from atlas.tasks c
where wh.stable_key='purchase-crane-kale-to-start'
  and c.engine_instance_key='workflow:confirm-crane-white-kale-seed-in-hand:2027';

update atlas.workflow_handoffs
set metadata = metadata || jsonb_build_object(
  'classification_reason', case
    when handoff_mode='automatic' then 'The source task is itself the complete prerequisite for the target work.'
    when handoff_mode='date_window' then 'The source starts a time window before the target should be checked or scheduled.'
    when handoff_mode='readiness_confirmed' then 'The target waits for an explicit biological or operational readiness confirmation.'
    when handoff_mode='resource_confirmed' then 'The target waits for explicit confirmation that the required resource is physically available.'
    else coalesce(metadata->>'classification_reason','Classified for Atlas workflow behavior.')
  end
)
where metadata->>'classification_reason' is null;

drop trigger if exists workflow_handoffs_validate_mode_v1 on atlas.workflow_handoffs;
create trigger workflow_handoffs_validate_mode_v1
before insert or update of handoff_mode, source_kind, source_id, source_event, source_filter, effect, target_task_id, target_date, delay_days
on atlas.workflow_handoffs
for each row execute function atlas.validate_workflow_handoff_mode_v1();

create or replace view atlas.workflow_handoff_classification_v1
with (security_invoker=true)
as
select
  h.id, h.farm_id, h.stable_key, h.handoff_mode, h.active,
  h.source_kind, h.source_id, h.source_key, h.source_event, h.source_filter,
  st.title as source_task_title,
  coalesce(nullif(st.action_key,''), nullif(st.metadata->>'work_route',''), st.task_type) as source_action,
  h.effect, h.target_task_id, tt.title as target_task_title,
  coalesce(nullif(tt.action_key,''), nullif(tt.metadata->>'work_route',''), tt.task_type) as target_action,
  h.target_date, h.delay_days, h.satisfied_at,
  h.metadata->>'classification_reason' as classification_reason,
  case
    when h.handoff_mode='date_window' and h.effect='schedule_task' and (h.target_date is not null or h.delay_days>0) then true
    when h.handoff_mode='readiness_confirmed' and h.source_kind='task' and (
      lower(coalesce(st.action_key,'')) in ('check','verify','readiness_check','transplant_readiness','propagation_readiness')
      or lower(coalesce(st.task_type,'')) like '%readiness%'
      or lower(coalesce(st.metadata->>'relationship_kind',''))='readiness_gate'
    ) then true
    when h.handoff_mode='resource_confirmed' and h.source_kind='task' and (
      lower(coalesce(st.action_key,'')) in ('confirm_resource','receive','inventory_check','resource_confirmation')
      or lower(coalesce(st.task_type,'')) in ('resource_confirmation','inventory_confirmation')
      or lower(coalesce(st.metadata->>'resource_confirmation','false')) in ('true','yes','1')
    ) then true
    when h.handoff_mode='owner_decision' and h.source_kind='task' and (
      st.visibility_scope='owner' or lower(coalesce(st.metadata->>'owner_task','false')) in ('true','yes','1')
    ) then true
    when h.handoff_mode='result_dependent' and h.source_filter<>'{}'::jsonb then true
    when h.handoff_mode='recurring_condition' and (h.source_kind<>'task' or h.source_filter<>'{}'::jsonb) then true
    when h.handoff_mode='automatic' then true
    else false
  end as classification_valid
from atlas.workflow_handoffs h
left join atlas.tasks st on h.source_kind='task' and st.id=h.source_id
left join atlas.tasks tt on tt.id=h.target_task_id;
