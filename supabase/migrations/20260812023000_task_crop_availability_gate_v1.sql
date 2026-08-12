-- Commercial outreach should enter a worker's Day because sellable farm reality
-- exists, not because somebody guessed a month on a calendar. This gate links a
-- downstream task to an observed crop_harvest_availability state without turning
-- the observation itself into a fake task.

create table if not exists atlas.task_crop_availability_gates (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  required_crop_label text not null,
  required_profile_metadata_key text,
  required_profile_metadata_value text,
  required_availability_status text not null default 'harvestable',
  gate_state text not null default 'waiting' check (gate_state in ('waiting','satisfied','retired')),
  restore_status text not null default 'open',
  restore_visibility_scope text not null default 'assigned_worker',
  restore_due_date date,
  satisfied_at timestamptz,
  source_crop_cycle_id uuid references atlas.crop_cycles(id) on delete set null,
  source_harvest_event_id uuid references atlas.crop_harvest_events(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id)
);

alter table atlas.task_crop_availability_gates enable row level security;
revoke all on atlas.task_crop_availability_gates from public,anon,authenticated;
grant select,insert,update,delete on atlas.task_crop_availability_gates to service_role;

create index if not exists task_crop_availability_gates_waiting_idx
  on atlas.task_crop_availability_gates(farm_id,gate_state)
  where gate_state='waiting';

create or replace function atlas.crop_profile_gate_matches_v1(
  p_profile_metadata jsonb,
  p_required_key text,
  p_required_value text
)
returns boolean
language sql
immutable
set search_path to 'pg_catalog','atlas'
as $function$
  select case
    when nullif(btrim(coalesce(p_required_key,'')),'') is null then true
    else lower(coalesce(p_profile_metadata->>p_required_key,''))=lower(coalesce(p_required_value,''))
  end
$function$;

revoke all on function atlas.crop_profile_gate_matches_v1(jsonb,text,text) from public,anon,authenticated;
grant execute on function atlas.crop_profile_gate_matches_v1(jsonb,text,text) to service_role;

create or replace function atlas.refresh_task_crop_availability_gate_v1(p_gate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_gate atlas.task_crop_availability_gates%rowtype;
  v_task atlas.tasks%rowtype;
  v_match record;
begin
  select * into v_gate
  from atlas.task_crop_availability_gates gate_row
  where gate_row.id=p_gate_id
  for update;

  if v_gate.id is null then
    raise exception 'Crop availability gate not found.' using errcode='P0002';
  end if;

  if v_gate.gate_state in ('satisfied','retired') then
    return jsonb_build_object('gateId',v_gate.id,'state',v_gate.gate_state,'changed',false);
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=v_gate.task_id
  for update;

  if v_task.id is null then
    update atlas.task_crop_availability_gates
    set gate_state='retired',updated_at=now(),metadata=metadata||jsonb_build_object('retired_reason','task_missing')
    where id=v_gate.id;
    return jsonb_build_object('gateId',v_gate.id,'state','retired','changed',true);
  end if;

  if v_task.status in ('done','archived','skipped') then
    update atlas.task_crop_availability_gates
    set gate_state='retired',updated_at=now(),metadata=metadata||jsonb_build_object('retired_reason','task_terminal')
    where id=v_gate.id;
    return jsonb_build_object('gateId',v_gate.id,'state','retired','changed',true);
  end if;

  select
    availability.crop_cycle_id,
    availability.source_event_id,
    availability.status,
    availability.observed_date,
    availability.estimated_quantity,
    availability.unit,
    profile.stable_key as crop_profile_key
  into v_match
  from atlas.crop_harvest_availability availability
  join atlas.crop_cycles cycle on cycle.id=availability.crop_cycle_id
  left join atlas.crop_profiles profile on profile.id=cycle.crop_profile_id
  where availability.farm_id=v_gate.farm_id
    and cycle.lifecycle_status='active'
    and lower(btrim(cycle.crop_label))=lower(btrim(v_gate.required_crop_label))
    and lower(availability.status)=lower(v_gate.required_availability_status)
    and atlas.crop_profile_gate_matches_v1(
      coalesce(profile.metadata,'{}'::jsonb),
      v_gate.required_profile_metadata_key,
      v_gate.required_profile_metadata_value
    )
  order by availability.observed_date desc nulls last,availability.updated_at desc,availability.crop_cycle_id
  limit 1;

  if v_match.crop_cycle_id is null then
    update atlas.tasks task
    set status='blocked',
        due_date=null,
        visibility_scope='system_internal',
        blocker_text=coalesce(nullif(v_gate.metadata->>'worker_waiting_text',''),'Waiting for required crop availability.'),
        metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
          'crop_availability_gate_id',v_gate.id,
          'crop_availability_gate_state','waiting',
          'source_ready',false,
          'source_readiness_checked_at',now()
        ),
        updated_at=now()
    where task.id=v_task.id;

    update atlas.task_crop_availability_gates
    set updated_at=now(),metadata=metadata||jsonb_build_object('last_checked_at',now())
    where id=v_gate.id;

    return jsonb_build_object('gateId',v_gate.id,'state','waiting','changed',false);
  end if;

  update atlas.task_crop_availability_gates
  set gate_state='satisfied',
      satisfied_at=now(),
      source_crop_cycle_id=v_match.crop_cycle_id,
      source_harvest_event_id=v_match.source_event_id,
      metadata=metadata||jsonb_build_object(
        'satisfied_by_status',v_match.status,
        'satisfied_observed_date',v_match.observed_date,
        'satisfied_estimated_quantity',v_match.estimated_quantity,
        'satisfied_unit',v_match.unit,
        'satisfied_crop_profile_key',v_match.crop_profile_key
      ),
      updated_at=now()
  where id=v_gate.id;

  update atlas.tasks task
  set status=v_gate.restore_status,
      due_date=v_gate.restore_due_date,
      visibility_scope=v_gate.restore_visibility_scope,
      blocker_text=null,
      metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
        'crop_availability_gate_id',v_gate.id,
        'crop_availability_gate_state','satisfied',
        'source_ready',true,
        'source_readiness_satisfied_at',now(),
        'source_readiness_crop_cycle_id',v_match.crop_cycle_id
      ),
      updated_at=now()
  where task.id=v_task.id;

  return jsonb_build_object(
    'gateId',v_gate.id,
    'state','satisfied',
    'changed',true,
    'taskId',v_task.id,
    'cropCycleId',v_match.crop_cycle_id
  );
end;
$function$;

revoke all on function atlas.refresh_task_crop_availability_gate_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.refresh_task_crop_availability_gate_v1(uuid) to service_role;

create or replace function atlas.refresh_waiting_crop_availability_gates_v1(p_farm_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_gate record;
  v_count integer:=0;
begin
  for v_gate in
    select id
    from atlas.task_crop_availability_gates
    where farm_id=p_farm_id and gate_state='waiting'
    order by created_at,id
  loop
    perform atlas.refresh_task_crop_availability_gate_v1(v_gate.id);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function atlas.refresh_waiting_crop_availability_gates_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.refresh_waiting_crop_availability_gates_v1(uuid) to service_role;

create or replace function atlas.refresh_crop_availability_gates_from_harvest_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  perform atlas.refresh_waiting_crop_availability_gates_v1(new.farm_id);
  return new;
end;
$function$;

revoke all on function atlas.refresh_crop_availability_gates_from_harvest_v1() from public,anon,authenticated;
grant execute on function atlas.refresh_crop_availability_gates_from_harvest_v1() to service_role;

drop trigger if exists refresh_crop_availability_gates_from_harvest_v1 on atlas.crop_harvest_availability;
create trigger refresh_crop_availability_gates_from_harvest_v1
after insert or update of status,observed_date,source_event_id,estimated_quantity on atlas.crop_harvest_availability
for each row
execute function atlas.refresh_crop_availability_gates_from_harvest_v1();

-- Normalize the one current commercial research move by stable identity. The
-- project can retain all commercial reasoning; the worker receives a complete,
-- literal action and only becomes eligible after an observed harvestable
-- pollenless sunflower crop exists.
do $block$
declare
  v_task atlas.tasks%rowtype;
  v_gate_id uuid;
begin
  select task.* into v_task
  from atlas.tasks task
  where task.metadata->>'task_key'='anna_price_cutter_nixa_vendor_path'
  order by task.created_at desc
  limit 1;

  if v_task.id is null then
    raise exception 'Price Cutter Nixa research task is missing; refusing crop-availability gate migration.';
  end if;
  if v_task.status<>'open' or v_task.visibility_scope<>'assigned_worker' then
    raise exception 'Price Cutter Nixa task state drifted; expected open assigned-worker task before gating.';
  end if;

  update atlas.tasks task
  set title='Visit Nixa Price Cutter to learn how Elm can become a local flower vendor',
      metadata=coalesce(task.metadata,'{}'::jsonb)||jsonb_build_object(
        'display_title','Visit Nixa Price Cutter to learn how Elm can become a local flower vendor',
        'display_action','Visit',
        'display_subject','Nixa Price Cutter',
        'display_location','Lillys Custom Floral inside Nixa Price Cutter',
        'execution_do','Visit Lillys Custom Floral inside Nixa Price Cutter and ask how Elm can become a local flower vendor.',
        'execution_place','Lillys Custom Floral inside Nixa Price Cutter · 400 North Massey Boulevard, Nixa, MO 65714',
        'execution_how',jsonb_build_array(
          'Ask who handles local-product or local-flower vendor onboarding.',
          'Ask which application or vendor path Elm should use.',
          'Get the contact name and contact method for the person or team who owns the next step.'
        ),
        'worker_result_label','Bring back',
        'worker_result_lines',jsonb_build_array(
          'Correct local-vendor application path',
          'Buyer or vendor contact name + contact method',
          'Any onboarding requirements they give you'
        ),
        'source_readiness_kind','marketable_crop_availability',
        'source_readiness_crop','Sunflower',
        'source_readiness_profile_trait','pollen_status=pollenless',
        'requires_source_ready',true,
        'source_ready',false
      ),
      updated_at=now()
  where task.id=v_task.id;

  insert into atlas.task_crop_availability_gates(
    farm_id,task_id,required_crop_label,required_profile_metadata_key,required_profile_metadata_value,
    required_availability_status,restore_status,restore_visibility_scope,restore_due_date,metadata
  )
  values(
    v_task.farm_id,v_task.id,'Sunflower','pollen_status','pollenless','harvestable',
    'open','assigned_worker',v_task.due_date,
    jsonb_build_object(
      'source','owner_instruction_20260811_price_cutter_harvest_unlock',
      'reason','Do not send worker commercial outreach until Elm has a real harvestable pollenless sunflower crop.',
      'worker_waiting_text','Waiting for a confirmed harvestable pollenless sunflower crop.'
    )
  )
  on conflict(task_id) do update
  set required_crop_label=excluded.required_crop_label,
      required_profile_metadata_key=excluded.required_profile_metadata_key,
      required_profile_metadata_value=excluded.required_profile_metadata_value,
      required_availability_status=excluded.required_availability_status,
      restore_status=excluded.restore_status,
      restore_visibility_scope=excluded.restore_visibility_scope,
      restore_due_date=excluded.restore_due_date,
      metadata=atlas.task_crop_availability_gates.metadata||excluded.metadata,
      updated_at=now()
  returning id into v_gate_id;

  perform atlas.refresh_task_crop_availability_gate_v1(v_gate_id);
end;
$block$;
