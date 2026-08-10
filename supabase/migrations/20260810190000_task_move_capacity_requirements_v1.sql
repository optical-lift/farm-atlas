begin;

create table if not exists atlas.task_capacity_requirements (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  capacity_pool_id uuid not null references atlas.capacity_pools(id) on delete restrict,
  capacity_role text not null default 'destination',
  quantity_needed numeric,
  unit text not null,
  window_start date,
  window_end date,
  requirement_status text not null default 'required',
  source text not null default 'manual',
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, capacity_pool_id, capacity_role),
  check (capacity_role in ('destination','holding','workspace','storage','throughput','other')),
  check (requirement_status in ('required','optional','satisfied','waived','blocked')),
  check (quantity_needed is null or quantity_needed >= 0),
  check (window_end is null or window_start is null or window_end >= window_start)
);

comment on table atlas.task_capacity_requirements is
  'Generic physical-capacity requirements attached to executable tasks. Separate from production-lot capacity planning and worker labor capacity.';

create index if not exists idx_task_capacity_requirements_task
  on atlas.task_capacity_requirements(task_id);
create index if not exists idx_task_capacity_requirements_pool
  on atlas.task_capacity_requirements(capacity_pool_id);

create table if not exists atlas.task_capacity_requirement_questions (
  id uuid primary key default gen_random_uuid(),
  task_capacity_requirement_id uuid not null references atlas.task_capacity_requirements(id) on delete cascade,
  question_id uuid not null references atlas.capacity_questions(id) on delete cascade,
  blocker_role text not null default 'calculation_input',
  created_at timestamptz not null default now(),
  unique (task_capacity_requirement_id, question_id),
  check (blocker_role in ('calculation_input','availability_input','placement_input','other'))
);

comment on table atlas.task_capacity_requirement_questions is
  'Links a task physical-capacity requirement to the canonical unanswered capacity questions that prevent resolution.';

alter table atlas.task_capacity_requirements enable row level security;
alter table atlas.task_capacity_requirement_questions enable row level security;

revoke all on table atlas.task_capacity_requirements from public, anon, authenticated;
revoke all on table atlas.task_capacity_requirement_questions from public, anon, authenticated;
grant all on table atlas.task_capacity_requirements to service_role;
grant all on table atlas.task_capacity_requirement_questions to service_role;

with target_task as (
  select t.id as task_id, t.farm_id, t.due_date
  from atlas.tasks t
  where t.metadata ->> 'task_key' = 'anna_20260810_pot_up_200_cell_snow_in_summer_tray_1'
    and t.status in ('open','blocked')
  order by t.updated_at desc
  limit 1
), target_pool as (
  select cp.id as capacity_pool_id, cp.farm_id
  from atlas.capacity_pools cp
  where cp.stable_key = 'grow_room_lit_shelf_positions'
    and cp.active = true
), inserted_requirement as (
  insert into atlas.task_capacity_requirements (
    farm_id,
    task_id,
    capacity_pool_id,
    capacity_role,
    quantity_needed,
    unit,
    window_start,
    requirement_status,
    source,
    note,
    metadata
  )
  select
    tt.farm_id,
    tt.task_id,
    tp.capacity_pool_id,
    'destination',
    4,
    'shelf_positions',
    tt.due_date,
    'required',
    'task_move_capacity_pass_3',
    'Four pot-up trays need lit Grow Room shelf positions after the Snow in Summer pot-up move.',
    jsonb_build_object(
      'task_move_branch', true,
      'destination_context', 'after_pot_up'
    )
  from target_task tt
  join target_pool tp on tp.farm_id = tt.farm_id
  on conflict (task_id, capacity_pool_id, capacity_role) do update
  set
    quantity_needed = excluded.quantity_needed,
    unit = excluded.unit,
    window_start = excluded.window_start,
    requirement_status = excluded.requirement_status,
    source = excluded.source,
    note = excluded.note,
    metadata = atlas.task_capacity_requirements.metadata || excluded.metadata,
    updated_at = now()
  returning id
), target_requirement as (
  select id from inserted_requirement
  union all
  select tcr.id
  from atlas.task_capacity_requirements tcr
  join target_task tt on tt.task_id = tcr.task_id
  join target_pool tp on tp.capacity_pool_id = tcr.capacity_pool_id
  where tcr.capacity_role = 'destination'
  limit 1
), target_questions as (
  select cq.id as question_id,
         case cq.stable_key
           when 'functional_grow_light_sets' then 'availability_input'
           when 'shelf_positions_per_grow_light_set' then 'calculation_input'
           else 'other'
         end as blocker_role
  from atlas.capacity_questions cq
  where cq.stable_key in ('functional_grow_light_sets','shelf_positions_per_grow_light_set')
    and cq.status = 'open'
)
insert into atlas.task_capacity_requirement_questions (
  task_capacity_requirement_id,
  question_id,
  blocker_role
)
select tr.id, tq.question_id, tq.blocker_role
from target_requirement tr
cross join target_questions tq
on conflict (task_capacity_requirement_id, question_id) do update
set blocker_role = excluded.blocker_role;

create or replace function atlas.task_capacity_requirements_api_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_farm_id uuid;
  v_visible boolean := false;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select t.farm_id
  into v_farm_id
  from atlas.tasks t
  where t.id = p_task_id
    and t.status <> 'archived';

  if v_farm_id is null then
    return '[]'::jsonb;
  end if;

  select exists (
    select 1
    from atlas.task_cards_v1(v_farm_id, p_task_id)
  ) into v_visible;

  if not v_visible then
    raise exception 'Task is not visible to the current Atlas viewer' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'requirement_id', tcr.id,
      'capacity_role', tcr.capacity_role,
      'quantity_needed', tcr.quantity_needed,
      'unit', tcr.unit,
      'window_start', tcr.window_start,
      'window_end', tcr.window_end,
      'requirement_status', tcr.requirement_status,
      'source', tcr.source,
      'note', tcr.note,
      'pool_id', cp.id,
      'pool_key', cp.stable_key,
      'pool_label', cp.label,
      'capacity_kind', cp.capacity_kind,
      'total_capacity', cp.total_capacity,
      'pool_unit', cp.unit,
      'capacity_status', cp.capacity_status,
      'pool_source', cp.source,
      'pool_metadata', cp.metadata,
      'questions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'question_id', cq.id,
          'question_key', cq.stable_key,
          'question_kind', cq.question_kind,
          'question_text', cq.question_text,
          'status', cq.status,
          'answer_value', cq.answer_value,
          'answer_unit', cq.answer_unit,
          'answer_text', cq.answer_text,
          'blocker_role', tcrq.blocker_role
        ) order by cq.created_at)
        from atlas.task_capacity_requirement_questions tcrq
        join atlas.capacity_questions cq on cq.id = tcrq.question_id
        where tcrq.task_capacity_requirement_id = tcr.id
      ), '[]'::jsonb)
    )
    order by tcr.created_at
  ), '[]'::jsonb)
  into v_result
  from atlas.task_capacity_requirements tcr
  join atlas.capacity_pools cp on cp.id = tcr.capacity_pool_id
  where tcr.task_id = p_task_id;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function atlas.task_capacity_requirements_api_v1(uuid) from public, anon;
grant execute on function atlas.task_capacity_requirements_api_v1(uuid) to authenticated;
grant execute on function atlas.task_capacity_requirements_api_v1(uuid) to service_role;

insert into atlas.authenticated_rpc_registry (
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  reviewed_at
)
values (
  'atlas.task_capacity_requirements_api_v1(uuid)',
  'policy_or_composition_helper',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'source', 'task_move_capacity_pass_3',
    'purpose', 'Viewer-scoped Task Move physical capacity branches',
    'visibility_boundary', 'atlas.task_cards_v1'
  ),
  now()
)
on conflict (signature) do update
set
  classification = excluded.classification,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  authenticated_execute_expected = excluded.authenticated_execute_expected,
  security_definer_expected = excluded.security_definer_expected,
  service_execute_expected = excluded.service_execute_expected,
  caller_count = excluded.caller_count,
  policy_reference_count = excluded.policy_reference_count,
  evidence = excluded.evidence,
  reviewed_at = excluded.reviewed_at;

commit;
