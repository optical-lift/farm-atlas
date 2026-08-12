create or replace function atlas.advance_gentle_pressure_wash_serial_queue_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_item atlas.task_release_queue_items%rowtype;
  v_completed_date date;
begin
  if new.status <> 'done' or old.status='done' then
    return new;
  end if;

  select qi.* into v_item
  from atlas.task_release_queue_items qi
  where qi.task_id=new.id
    and qi.state='active'
    and qi.queue_key='anna_gentle_pressure_wash_aug_2026'
  for update;

  if not found then
    return new;
  end if;

  update atlas.task_release_queue_items
  set state='completed',
      completed_at=coalesce(new.completed_at,now()),
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'completed_task_id',new.id,
        'completed_at',coalesce(new.completed_at,now()),
        'completion_gate_advanced',true
      )
  where id=v_item.id;

  v_completed_date := (coalesce(new.completed_at,now()) at time zone 'America/Chicago')::date;
  perform atlas.release_next_task_in_queue_v1(v_item.farm_id,v_item.queue_key,v_completed_date);
  return new;
end;
$function$;

revoke all on function atlas.advance_gentle_pressure_wash_serial_queue_v1() from public,anon,authenticated;
grant execute on function atlas.advance_gentle_pressure_wash_serial_queue_v1() to service_role;

drop trigger if exists advance_gentle_pressure_wash_serial_queue_v1 on atlas.tasks;
create trigger advance_gentle_pressure_wash_serial_queue_v1
after update of status on atlas.tasks
for each row
execute function atlas.advance_gentle_pressure_wash_serial_queue_v1();

do $block$
declare
  v_farm_id uuid := '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f';
  v_queue_key text := 'anna_gentle_pressure_wash_aug_2026';
  v_current atlas.tasks%rowtype;
  v_six atlas.tasks%rowtype;
  v_seven atlas.tasks%rowtype;
  v_occ6 uuid;
  v_occ7 uuid;
  v_policy6 uuid;
  v_policy7 uuid;
begin
  select t.* into v_current
  from atlas.tasks t
  where t.farm_id=v_farm_id
    and t.metadata->>'pressure_wash_collection_key'=v_queue_key
    and (t.metadata->>'pressure_wash_source_order')::integer=5
    and t.status in ('open','blocked')
  order by t.created_at desc
  limit 1;

  if v_current.id is null then
    raise exception 'Current detached-garage pressure-wash task is missing; refusing serial-queue migration.';
  end if;

  select t.* into v_six
  from atlas.tasks t
  where t.farm_id=v_farm_id
    and t.metadata->>'pressure_wash_collection_key'=v_queue_key
    and (t.metadata->>'pressure_wash_source_order')::integer=6
    and t.status in ('open','blocked')
  order by t.created_at desc
  limit 1;

  select t.* into v_seven
  from atlas.tasks t
  where t.farm_id=v_farm_id
    and t.metadata->>'pressure_wash_collection_key'=v_queue_key
    and (t.metadata->>'pressure_wash_source_order')::integer=7
    and t.status in ('open','blocked')
  order by t.created_at desc
  limit 1;

  if v_six.id is null or v_six.planned_occurrence_id is null then
    raise exception 'Pressure-wash source order 6 is missing a releasable occurrence.';
  end if;
  if v_seven.id is null or v_seven.planned_occurrence_id is null then
    raise exception 'Pressure-wash source order 7 is missing a releasable occurrence.';
  end if;

  v_occ6 := v_six.planned_occurrence_id;
  v_occ7 := v_seven.planned_occurrence_id;
  v_policy6 := v_six.release_policy_id;
  v_policy7 := v_seven.release_policy_id;

  perform set_config('atlas.reservoir_migration','on',true);
  perform atlas.defer_existing_task_to_occurrence_v1(v_six.id,'Convert independently dated pressure washing to one-at-a-time completion-gated work.');
  perform atlas.defer_existing_task_to_occurrence_v1(v_seven.id,'Convert independently dated pressure washing to one-at-a-time completion-gated work.');
  perform set_config('atlas.reservoir_migration','off',true);

  update atlas.tasks
  set work_lane='process_continuation',
      commitment_kind='persistent',
      metadata=(coalesce(metadata,'{}'::jsonb)-'scheduled_to_appear_on_due_date'-'date_commitment')||jsonb_build_object(
        'pressure_wash_release_mode','completion_gated_serial',
        'release_queue_key',v_queue_key,
        'release_queue_position',1,
        'release_queue_state','active',
        'release_timing','next_workday',
        'commitment_kind','persistent'
      ),
      updated_at=now()
  where id=v_current.id;

  update atlas.work_release_policies
  set gate_type='serial_queue',horizon_days=0,maximum_active_instances=1,updated_at=now()
  where id in (v_current.release_policy_id,v_policy6,v_policy7);

  update atlas.planned_work_occurrences
  set work_lane='process_continuation',
      commitment_kind='persistent',
      planned_due_date=null,
      not_before_date=null,
      gate_satisfied_at=null,
      state='planned',
      released_at=null,
      released_task_id=null,
      task_payload=jsonb_set(
        jsonb_set(coalesce(task_payload,'{}'::jsonb),'{metadata,pressure_wash_release_mode}','"completion_gated_serial"'::jsonb,true),
        '{metadata,commitment_kind}','"persistent"'::jsonb,true
      ),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'pressure_wash_release_mode','completion_gated_serial',
        'held_until_previous_completion',true
      ),
      updated_at=now()
  where id in (v_occ6,v_occ7);

  insert into atlas.task_release_queue_items(
    farm_id,queue_key,task_id,planned_occurrence_id,position,state,initial_batch,original_due_date,activated_at,metadata
  ) values (
    v_farm_id,v_queue_key,v_current.id,v_current.planned_occurrence_id,1,'active',false,v_current.due_date,now(),
    jsonb_build_object('policy','completion_gated_serial','release_timing','next_workday','source','owner_instruction_20260812_pressure_wash_serial')
  )
  on conflict(farm_id,queue_key,position) do update
  set task_id=excluded.task_id,planned_occurrence_id=excluded.planned_occurrence_id,state='active',activated_at=coalesce(atlas.task_release_queue_items.activated_at,now()),metadata=atlas.task_release_queue_items.metadata||excluded.metadata,updated_at=now();

  insert into atlas.task_release_queue_items(
    farm_id,queue_key,task_id,planned_occurrence_id,position,state,initial_batch,original_due_date,metadata
  ) values
    (v_farm_id,v_queue_key,null,v_occ6,2,'queued',false,v_six.due_date,jsonb_build_object('policy','completion_gated_serial','release_timing','next_workday','source','owner_instruction_20260812_pressure_wash_serial')),
    (v_farm_id,v_queue_key,null,v_occ7,3,'queued',false,v_seven.due_date,jsonb_build_object('policy','completion_gated_serial','release_timing','next_workday','source','owner_instruction_20260812_pressure_wash_serial'))
  on conflict(farm_id,queue_key,position) do update
  set task_id=null,planned_occurrence_id=excluded.planned_occurrence_id,state='queued',metadata=atlas.task_release_queue_items.metadata||excluded.metadata,updated_at=now();

  perform atlas.sync_task_release_queue_summary_v1(v_farm_id,v_queue_key);
end;
$block$;
