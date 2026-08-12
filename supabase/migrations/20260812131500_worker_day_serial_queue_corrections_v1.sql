-- Worker Day serial-work correction.
--
-- Two independent schedulers were competing for the same daily weeding slot:
-- a persistent Weed Card could create a same-card next-day replacement while the
-- Anna weeding queue also advanced to the next bed. The queue is the day-level
-- scheduler; the Weed Card remains physical state/evidence and can re-enter the
-- queue later when its condition warrants another serving.
--
-- Pressure washing is likewise a serial process continuation. Materialize the
-- exact queued pressure-wash occurrence instead of asking the general release
-- sweep to choose among unrelated eligible work.

-- Preserve the original non-serial Weed Card release implementation under a
-- narrower name, then put a serial-queue guard at the canonical function name.
do $block$
begin
  if to_regprocedure('atlas.release_weed_card_continuation_unqueued_v1(uuid,uuid)') is null
     and to_regprocedure('atlas.release_weed_card_continuation_v1(uuid,uuid)') is not null
  then
    alter function atlas.release_weed_card_continuation_v1(uuid,uuid)
      rename to release_weed_card_continuation_unqueued_v1;
  end if;
end;
$block$;

create or replace function atlas.release_weed_card_continuation_v1(
  p_occurrence_id uuid,
  p_source_task_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_source atlas.tasks%rowtype;
  v_serial_managed boolean := false;
begin
  if p_occurrence_id is null or p_source_task_id is null then
    raise exception 'Occurrence and source task are required.' using errcode='22023';
  end if;

  select task.* into v_source
  from atlas.tasks task
  where task.id=p_source_task_id;

  if v_source.id is null then
    raise exception 'Source Weed Card task not found.' using errcode='P0002';
  end if;

  v_serial_managed :=
    lower(coalesce(v_source.metadata->>'weed_serial_gate','false')) in ('true','yes','1')
    or v_source.metadata->>'release_queue_key'='anna_weeding_rotation'
    or exists(
      select 1
      from atlas.task_release_queue_items queue_item
      where queue_item.farm_id=v_source.farm_id
        and queue_item.queue_key='anna_weeding_rotation'
        and (
          queue_item.task_id=v_source.id
          or (
            v_source.planned_occurrence_id is not null
            and queue_item.planned_occurrence_id=v_source.planned_occurrence_id
          )
        )
    );

  if v_serial_managed then
    update atlas.planned_work_occurrences occurrence
    set state='cancelled',
        released_at=null,
        released_task_id=null,
        metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object(
          'cancelled_reason','Anna daily weeding is completion-gated by anna_weeding_rotation; do not create a same-card next-day copy.',
          'cancelled_at',now(),
          'serial_queue_owns_daily_serving',true,
          'serial_queue_key','anna_weeding_rotation',
          'serial_queue_source_task_id',v_source.id
        ),
        updated_at=now()
    where occurrence.id=p_occurrence_id
      and occurrence.state not in ('completed','cancelled');

    return null;
  end if;

  if to_regprocedure('atlas.release_weed_card_continuation_unqueued_v1(uuid,uuid)') is null then
    raise exception 'Unqueued Weed Card continuation implementation is missing.' using errcode='42883';
  end if;

  return atlas.release_weed_card_continuation_unqueued_v1(p_occurrence_id,p_source_task_id);
end;
$function$;

revoke all on function atlas.release_weed_card_continuation_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function atlas.release_weed_card_continuation_v1(uuid,uuid) to service_role;

-- Materialize exactly one pressure-wash queue item. This deliberately does not
-- call release_eligible_work_v1 because that function is allowed to choose any
-- higher-ranked eligible occurrence on the farm.
create or replace function atlas.release_pressure_wash_queue_item_v1(
  p_queue_item_id uuid,
  p_due_date date
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_item atlas.task_release_queue_items%rowtype;
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_template atlas.tasks%rowtype;
  v_task_id uuid;
  v_existing uuid;
  v_metadata jsonb;
  v_window_key text;
  v_window jsonb;
  v_release_time time;
  v_close_time time;
begin
  if p_queue_item_id is null or p_due_date is null then
    raise exception 'Queue item and due date are required.' using errcode='22023';
  end if;

  select item.* into v_item
  from atlas.task_release_queue_items item
  where item.id=p_queue_item_id
    and item.queue_key='anna_gentle_pressure_wash_aug_2026'
  for update;

  if v_item.id is null then
    raise exception 'Pressure-wash queue item not found.' using errcode='P0002';
  end if;

  if v_item.state='completed' then
    return v_item.task_id;
  end if;

  if v_item.state='active' and v_item.task_id is not null
     and exists(
       select 1 from atlas.tasks task
       where task.id=v_item.task_id and task.status in ('open','blocked')
     )
  then
    return v_item.task_id;
  end if;

  if v_item.planned_occurrence_id is null then
    raise exception 'Pressure-wash queue item has no planned occurrence.' using errcode='23514';
  end if;

  select occurrence.* into v_occurrence
  from atlas.planned_work_occurrences occurrence
  where occurrence.id=v_item.planned_occurrence_id
  for update;

  if v_occurrence.id is null or v_occurrence.farm_id<>v_item.farm_id then
    raise exception 'Pressure-wash occurrence is missing or belongs to another farm.' using errcode='23514';
  end if;
  if v_occurrence.state in ('completed','cancelled') then
    raise exception 'Pressure-wash occurrence is already terminal.' using errcode='22023';
  end if;

  select task.id into v_existing
  from atlas.tasks task
  where task.planned_occurrence_id=v_occurrence.id
    and task.status in ('open','blocked')
  order by task.created_at,task.id
  limit 1;

  if v_existing is not null then
    update atlas.planned_work_occurrences
    set state='released',
        planned_due_date=p_due_date,
        not_before_date=p_due_date,
        released_at=coalesce(released_at,now()),
        released_task_id=v_existing,
        updated_at=now()
    where id=v_occurrence.id;

    update atlas.tasks
    set due_date=p_due_date,
        work_lane='process_continuation',
        commitment_kind='persistent',
        metadata=(coalesce(metadata,'{}'::jsonb)-'scheduled_to_appear_on_due_date'-'date_commitment')||jsonb_build_object(
          'pressure_wash_release_mode','completion_gated_serial',
          'release_queue_key',v_item.queue_key,
          'release_queue_position',v_item.position,
          'release_queue_state','active',
          'release_timing','next_workday',
          'execution_date',p_due_date,
          'commitment_kind','persistent'
        ),
        updated_at=now()
    where id=v_existing;

    update atlas.task_release_queue_items
    set state='active',task_id=v_existing,activated_at=coalesce(activated_at,now()),updated_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'released_for_date',p_due_date,
          'released_at',now(),
          'release_architecture','exact_serial_occurrence_v1'
        )
    where id=v_item.id;

    perform atlas.sync_task_release_queue_summary_v1(v_item.farm_id,v_item.queue_key);
    return v_existing;
  end if;

  select * into v_template
  from jsonb_populate_record(null::atlas.tasks,v_occurrence.task_payload);

  v_metadata :=
    (coalesce(v_template.metadata,'{}'::jsonb)-'scheduled_to_appear_on_due_date'-'date_commitment')
    || jsonb_build_object(
      'pressure_wash_release_mode','completion_gated_serial',
      'release_queue_key',v_item.queue_key,
      'release_queue_position',v_item.position,
      'release_queue_state','active',
      'release_timing','next_workday',
      'execution_date',p_due_date,
      'commitment_kind','persistent'
    );

  update atlas.planned_work_occurrences
  set state='releasing',
      work_lane='process_continuation',
      commitment_kind='persistent',
      planned_due_date=p_due_date,
      not_before_date=p_due_date,
      gate_satisfied_at=coalesce(gate_satisfied_at,now()),
      updated_at=now()
  where id=v_occurrence.id;

  insert into atlas.tasks(
    farm_id,zone_id,title,task_type,status,priority,due_date,unlock_text,note,metadata,
    action_key,work_class,visibility_scope,assigned_membership_id,assigned_user_id,
    created_by_user_id,origin_kind,task_scope,planned_occurrence_id,release_policy_id,
    released_at,release_reason,organization_id,work_lane,commitment_kind,effort_units
  ) values (
    v_occurrence.farm_id,
    v_template.zone_id,
    coalesce(nullif(v_template.title,''),v_occurrence.title),
    coalesce(nullif(v_template.task_type,''),'exterior_cleaning'),
    'open',
    coalesce(nullif(v_template.priority,''),'normal'),
    p_due_date,
    v_template.unlock_text,
    v_template.note,
    v_metadata,
    coalesce(nullif(v_template.action_key,''),'pressure_wash'),
    coalesce(nullif(v_template.work_class,''),'standard'),
    coalesce(nullif(v_template.visibility_scope,''),'assigned_worker'),
    v_template.assigned_membership_id,
    v_template.assigned_user_id,
    v_template.created_by_user_id,
    case when v_template.origin_kind in ('legacy','owner_assigned','contributor_created','generated')
      then v_template.origin_kind else 'generated' end,
    coalesce(nullif(v_template.task_scope,''),'farm_operation'),
    v_occurrence.id,
    v_occurrence.release_policy_id,
    now(),
    'process_continuation',
    v_template.organization_id,
    'process_continuation',
    'persistent',
    coalesce(v_occurrence.effort_units,1)
  ) returning id into v_task_id;

  perform atlas.restore_task_relation_payload_v1(v_task_id,coalesce(v_occurrence.relation_payload,'{}'::jsonb));
  perform atlas.attach_released_task_to_source_v1(v_occurrence.id,v_task_id);

  update atlas.planned_work_occurrences
  set state='released',
      released_at=now(),
      released_task_id=v_task_id,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'releasedBy','release_pressure_wash_queue_item_v1',
        'releasedLane','process_continuation',
        'releasedExecutionDate',p_due_date,
        'pressure_wash_release_mode','completion_gated_serial'
      ),
      updated_at=now()
  where id=v_occurrence.id;

  update atlas.task_release_queue_items
  set task_id=v_task_id,
      state='active',
      activated_at=now(),
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'released_for_date',p_due_date,
        'released_at',now(),
        'release_architecture','exact_serial_occurrence_v1'
      )
  where id=v_item.id;

  insert into atlas.task_release_events(
    farm_id,occurrence_id,release_policy_id,task_id,release_reason,metadata
  ) values (
    v_occurrence.farm_id,v_occurrence.id,v_occurrence.release_policy_id,v_task_id,
    'process_continuation',
    jsonb_build_object(
      'workLane','process_continuation',
      'commitmentKind','persistent',
      'effortUnits',coalesce(v_occurrence.effort_units,1),
      'executionDate',p_due_date,
      'queueKey',v_item.queue_key,
      'queuePosition',v_item.position
    )
  ) on conflict (occurrence_id,task_id) do nothing;

  v_window_key := coalesce(
    nullif(v_metadata->>'work_window_key',''),
    nullif(v_metadata->>'window_key',''),
    'morning'
  );
  v_window := atlas.maintenance_directive_window_v1(v_window_key);
  if v_window is not null then
    v_release_time := (v_window->>'release')::time;
    v_close_time := (v_window->>'close')::time;
    insert into atlas.task_notification_plans(
      farm_id,task_id,release_local_time,close_local_time,nudge_after_minutes,
      group_key,group_label,source,active,metadata
    ) values (
      v_occurrence.farm_id,v_task_id,v_release_time,v_close_time,60,
      'pressure-wash:'||v_item.queue_key,
      coalesce(v_window->>'label','Farm work'),
      'pressure_wash_serial_queue',true,
      jsonb_build_object(
        'occurrenceId',v_occurrence.id,
        'workLane','process_continuation',
        'workWindowKey',v_window_key,
        'queuePosition',v_item.position
      )
    ) on conflict (task_id) do update
    set release_local_time=excluded.release_local_time,
        close_local_time=excluded.close_local_time,
        nudge_after_minutes=excluded.nudge_after_minutes,
        group_key=excluded.group_key,
        group_label=excluded.group_label,
        source=excluded.source,
        active=true,
        metadata=atlas.task_notification_plans.metadata||excluded.metadata,
        updated_at=now();
  end if;

  perform atlas.sync_task_release_queue_summary_v1(v_item.farm_id,v_item.queue_key);
  return v_task_id;
end;
$function$;

revoke all on function atlas.release_pressure_wash_queue_item_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.release_pressure_wash_queue_item_v1(uuid,date) to service_role;

create or replace function atlas.release_next_pressure_wash_task_v1(
  p_farm_id uuid,
  p_completed_date date
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_queue_key constant text := 'anna_gentle_pressure_wash_aug_2026';
  v_item atlas.task_release_queue_items%rowtype;
  v_due_date date;
  v_timezone text := 'America/Chicago';
  v_existing uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':'||v_queue_key,0));

  select coalesce(nullif(farm.metadata->>'timezone',''),'America/Chicago') into v_timezone
  from atlas.farms farm where farm.id=p_farm_id;

  -- Clear a stale active pointer only when its task is no longer active.
  update atlas.task_release_queue_items item
  set state='queued',task_id=null,activated_at=null,updated_at=now(),
      metadata=coalesce(item.metadata,'{}'::jsonb)||jsonb_build_object('stale_active_pointer_cleared_at',now())
  where item.farm_id=p_farm_id
    and item.queue_key=v_queue_key
    and item.state='active'
    and (
      item.task_id is null
      or not exists(
        select 1 from atlas.tasks task
        where task.id=item.task_id and task.status in ('open','blocked')
      )
    );

  select item.task_id into v_existing
  from atlas.task_release_queue_items item
  join atlas.tasks task on task.id=item.task_id
  where item.farm_id=p_farm_id
    and item.queue_key=v_queue_key
    and item.state='active'
    and task.status in ('open','blocked')
  order by item.position
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  select item.* into v_item
  from atlas.task_release_queue_items item
  where item.farm_id=p_farm_id
    and item.queue_key=v_queue_key
    and item.state='queued'
  order by item.position
  for update
  limit 1;

  if v_item.id is null then
    perform atlas.sync_task_release_queue_summary_v1(p_farm_id,v_queue_key);
    return null;
  end if;

  if p_completed_date is null then
    v_due_date := (now() at time zone v_timezone)::date;
  else
    v_due_date := p_completed_date+1;
    if extract(dow from v_due_date)=0 then
      v_due_date := v_due_date+1;
    end if;
  end if;

  return atlas.release_pressure_wash_queue_item_v1(v_item.id,v_due_date);
end;
$function$;

revoke all on function atlas.release_next_pressure_wash_task_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.release_next_pressure_wash_task_v1(uuid,date) to service_role;

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
  if new.status<>'done' or old.status='done' then
    return new;
  end if;

  select item.* into v_item
  from atlas.task_release_queue_items item
  where item.task_id=new.id
    and item.state='active'
    and item.queue_key='anna_gentle_pressure_wash_aug_2026'
  for update;

  if v_item.id is null then
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
  perform atlas.release_next_pressure_wash_task_v1(v_item.farm_id,v_completed_date);
  return new;
end;
$function$;

revoke all on function atlas.advance_gentle_pressure_wash_serial_queue_v1() from public,anon,authenticated;
grant execute on function atlas.advance_gentle_pressure_wash_serial_queue_v1() to service_role;

-- Complete the existing Elm queue and repair the current head if an earlier
-- partial migration left the queue with no active pressure-wash task.
do $block$
declare
  v_queue_key constant text := 'anna_gentle_pressure_wash_aug_2026';
  v_farm_id uuid;
  v_front atlas.planned_work_occurrences%rowtype;
  v_concrete atlas.planned_work_occurrences%rowtype;
  v_item_id uuid;
begin
  select item.farm_id into v_farm_id
  from atlas.task_release_queue_items item
  where item.queue_key=v_queue_key
  order by item.created_at
  limit 1;

  if v_farm_id is null then
    raise exception 'Pressure-wash queue is missing; apply gentle_pressure_wash_serial_queue_v1 first.';
  end if;

  select occurrence.* into v_front
  from atlas.planned_work_occurrences occurrence
  where occurrence.farm_id=v_farm_id
    and occurrence.task_payload->'metadata'->>'task_key'='anna_20260814_gentle_pressure_wash_front_porch'
  order by occurrence.created_at desc
  limit 1;

  select occurrence.* into v_concrete
  from atlas.planned_work_occurrences occurrence
  where occurrence.farm_id=v_farm_id
    and occurrence.task_payload->'metadata'->>'task_key'='anna_20260815_gentle_pressure_wash_concrete_entrance_porch'
  order by occurrence.created_at desc
  limit 1;

  if v_front.id is null or v_concrete.id is null then
    raise exception 'Remaining front-porch pressure-wash occurrences are missing; refusing partial queue extension.';
  end if;

  update atlas.planned_work_occurrences occurrence
  set work_lane='process_continuation',
      commitment_kind='persistent',
      planned_due_date=null,
      not_before_date=null,
      gate_satisfied_at=null,
      state=case when occurrence.state in ('completed','cancelled') then occurrence.state else 'planned' end,
      released_at=case when occurrence.state in ('completed','cancelled') then occurrence.released_at else null end,
      released_task_id=case when occurrence.state in ('completed','cancelled') then occurrence.released_task_id else null end,
      task_payload=jsonb_set(
        jsonb_set(coalesce(occurrence.task_payload,'{}'::jsonb),'{metadata,pressure_wash_release_mode}','"completion_gated_serial"'::jsonb,true),
        '{metadata,commitment_kind}','"persistent"'::jsonb,true
      ),
      metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object(
        'pressure_wash_release_mode','completion_gated_serial',
        'held_until_previous_completion',true
      ),
      updated_at=now()
  where occurrence.id in (v_front.id,v_concrete.id);

  update atlas.work_release_policies policy
  set gate_type='serial_queue',horizon_days=0,maximum_active_instances=1,updated_at=now()
  where policy.id in (
    select occurrence.release_policy_id
    from atlas.planned_work_occurrences occurrence
    join atlas.task_release_queue_items item on item.planned_occurrence_id=occurrence.id
    where item.farm_id=v_farm_id and item.queue_key=v_queue_key
    union
    select v_front.release_policy_id
    union
    select v_concrete.release_policy_id
  );

  insert into atlas.task_release_queue_items(
    farm_id,queue_key,task_id,planned_occurrence_id,position,state,initial_batch,original_due_date,metadata
  ) values
    (v_farm_id,v_queue_key,null,v_front.id,4,'queued',false,v_front.planned_due_date,
      jsonb_build_object('policy','completion_gated_serial','release_timing','next_workday','source','owner_instruction_20260812_pressure_wash_serial_completion')),
    (v_farm_id,v_queue_key,null,v_concrete.id,5,'queued',false,v_concrete.planned_due_date,
      jsonb_build_object('policy','completion_gated_serial','release_timing','next_workday','source','owner_instruction_20260812_pressure_wash_serial_completion'))
  on conflict(farm_id,queue_key,position) do update
  set planned_occurrence_id=excluded.planned_occurrence_id,
      task_id=case when atlas.task_release_queue_items.state='active' then atlas.task_release_queue_items.task_id else null end,
      state=case when atlas.task_release_queue_items.state in ('active','completed') then atlas.task_release_queue_items.state else 'queued' end,
      original_due_date=coalesce(atlas.task_release_queue_items.original_due_date,excluded.original_due_date),
      metadata=atlas.task_release_queue_items.metadata||excluded.metadata,
      updated_at=now();

  -- Any queued pressure-wash occurrence is calendarless until it becomes the
  -- sole active head. This is the key anti-pile-up invariant.
  update atlas.planned_work_occurrences occurrence
  set work_lane='process_continuation',
      commitment_kind='persistent',
      planned_due_date=null,
      not_before_date=null,
      gate_satisfied_at=null,
      state=case when occurrence.state in ('completed','cancelled') then occurrence.state else 'planned' end,
      released_at=case when occurrence.state in ('completed','cancelled') then occurrence.released_at else null end,
      released_task_id=case when occurrence.state in ('completed','cancelled') then occurrence.released_task_id else null end,
      metadata=coalesce(occurrence.metadata,'{}'::jsonb)||jsonb_build_object(
        'pressure_wash_release_mode','completion_gated_serial',
        'held_until_previous_completion',true
      ),
      updated_at=now()
  from atlas.task_release_queue_items item
  where item.farm_id=v_farm_id
    and item.queue_key=v_queue_key
    and item.state='queued'
    and item.planned_occurrence_id=occurrence.id;

  perform atlas.sync_task_release_queue_summary_v1(v_farm_id,v_queue_key);

  if not exists(
    select 1
    from atlas.task_release_queue_items item
    join atlas.tasks task on task.id=item.task_id
    where item.farm_id=v_farm_id
      and item.queue_key=v_queue_key
      and item.state='active'
      and task.status in ('open','blocked')
  ) then
    perform atlas.release_next_pressure_wash_task_v1(v_farm_id,null);
  end if;
end;
$block$;
