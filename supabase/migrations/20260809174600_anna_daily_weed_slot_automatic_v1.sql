create or replace function atlas.release_next_task_in_queue_v1(
  p_farm_id uuid,
  p_queue_key text,
  p_completed_date date default null::date
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $$
declare
  v_next_item atlas.task_release_queue_items%rowtype;
  v_due_date date;
  v_completed_date date:=coalesce(p_completed_date,(now() at time zone 'America/Chicago')::date);
  v_occurrence_id uuid;
  v_task_id uuid;
  v_release_timing text;
  v_approval_required boolean:=false;
  v_approved_date date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':'||p_queue_key,0));

  if exists(
    select 1
    from atlas.task_release_queue_items qi
    left join atlas.tasks task on task.id=qi.task_id
    left join atlas.planned_work_occurrences occurrence on occurrence.id=qi.planned_occurrence_id
    where qi.farm_id=p_farm_id
      and qi.queue_key=p_queue_key
      and qi.initial_batch
      and qi.state<>'completed'
      and coalesce(task.status,'open')<>'done'
      and coalesce(occurrence.state,'released')<>'completed'
  ) then
    perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key);
    return null;
  end if;

  select qi.* into v_next_item
  from atlas.task_release_queue_items qi
  where qi.farm_id=p_farm_id
    and qi.queue_key=p_queue_key
    and qi.state='queued'
  order by qi.position
  for update
  limit 1;

  if not found then
    perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key);
    return null;
  end if;

  v_approval_required := coalesce((v_next_item.metadata->>'owner_schedule_approval_required')::boolean,false);
  v_approved_date:=nullif(v_next_item.metadata->>'owner_schedule_approved_date','')::date;

  if v_approval_required and v_approved_date is null then
    update atlas.task_release_queue_items
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'owner_schedule_approval_required',true,
          'awaiting_owner_schedule_approval',true,
          'awaiting_owner_schedule_approval_at',now()
        ),
        updated_at=now()
    where id=v_next_item.id;
    perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key);
    return null;
  end if;

  v_occurrence_id:=coalesce(
    v_next_item.planned_occurrence_id,
    (select task.planned_occurrence_id from atlas.tasks task where task.id=v_next_item.task_id)
  );
  if v_occurrence_id is null then
    raise exception 'Queued item % has no planned occurrence and cannot be released safely.',v_next_item.id using errcode='23514';
  end if;

  v_release_timing:=coalesce(nullif(v_next_item.metadata->>'release_timing',''),'next_workday');
  if v_release_timing='same_day' then
    v_due_date:=v_completed_date;
  else
    v_due_date:=v_completed_date+1;
    if extract(dow from v_due_date)=0 then v_due_date:=v_due_date+1; end if;
  end if;

  if v_approved_date is not null then
    v_due_date:=greatest(v_due_date,v_approved_date);
  end if;
  if extract(dow from v_due_date)=0 then v_due_date:=v_due_date+1; end if;

  update atlas.planned_work_occurrences
  set planned_due_date=v_due_date,
      not_before_date=v_due_date,
      gate_satisfied_at=now(),
      state=case when state in ('released','completed') then state else 'eligible' end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'release_queue_key',p_queue_key,
        'release_queue_position',v_next_item.position,
        'released_after_previous_completion',true,
        'released_for_date',v_due_date,
        'queue_gate_satisfied_at',now(),
        'queue_release_timing',v_release_timing
      ),
      updated_at=now()
  where id=v_occurrence_id;

  perform atlas.release_eligible_work_v1(p_farm_id,v_due_date,1);
  select released_task_id into v_task_id
  from atlas.planned_work_occurrences
  where id=v_occurrence_id;

  if v_task_id is not null
     and exists(select 1 from atlas.tasks where id=v_task_id and status in ('open','blocked')) then
    update atlas.task_release_queue_items
    set task_id=v_task_id,
        planned_occurrence_id=v_occurrence_id,
        state='active',
        activated_at=now(),
        updated_at=now(),
        metadata=(coalesce(metadata,'{}'::jsonb)-'awaiting_owner_schedule_approval'-'awaiting_owner_schedule_approval_at')||jsonb_build_object(
          'owner_schedule_approval_required',v_approval_required,
          'released_after_completion',true,
          'released_for_date',v_due_date,
          'released_at',now(),
          'release_timing',v_release_timing,
          'release_architecture','planned_occurrence_gate'
        )
    where id=v_next_item.id;
  else
    update atlas.task_release_queue_items
    set planned_occurrence_id=v_occurrence_id,
        task_id=null,
        state='queued',
        updated_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'owner_schedule_approval_required',v_approval_required,
          'release_attempted_at',now(),
          'release_waiting_on_capacity',true,
          'release_timing',v_release_timing,
          'release_architecture','planned_occurrence_gate'
        )
    where id=v_next_item.id;
    v_task_id:=null;
  end if;

  perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key);
  return v_task_id;
end;
$$;

update atlas.task_release_queue_items qi
set metadata=(coalesce(qi.metadata,'{}'::jsonb)
      - 'owner_schedule_approved_date'
      - 'owner_schedule_approved_at'
      - 'owner_schedule_approval_source'
      - 'awaiting_owner_schedule_approval'
      - 'awaiting_owner_schedule_approval_at')
    || jsonb_build_object(
      'owner_schedule_approval_required',false,
      'automatic_daily_slot',true,
      'release_timing','next_workday',
      'daily_slot_policy','exactly_one_weed_card_per_workday',
      'daily_slot_policy_updated_at',now()
    ),
    updated_at=now()
from atlas.farms f
where qi.farm_id=f.id
  and f.stable_key='elm_farm'
  and qi.queue_key='anna_weeding_rotation'
  and qi.state in ('active','queued');

update atlas.planned_work_occurrences occurrence
set metadata=(coalesce(occurrence.metadata,'{}'::jsonb)
      - 'owner_schedule_approved_date'
      - 'owner_schedule_approved_at'
      - 'owner_schedule_approval_source')
    || jsonb_build_object(
      'automatic_daily_slot',true,
      'queue_release_timing','next_workday',
      'daily_slot_policy','exactly_one_weed_card_per_workday'
    ),
    task_payload=jsonb_set(
      coalesce(occurrence.task_payload,'{}'::jsonb),
      '{metadata}',
      (coalesce(occurrence.task_payload->'metadata','{}'::jsonb)
        - 'owner_schedule_approved_date'
        - 'owner_schedule_approved_at'
        - 'owner_schedule_approval_source')
        || jsonb_build_object(
          'automatic_daily_slot',true,
          'release_timing','next_workday',
          'daily_slot_policy','exactly_one_weed_card_per_workday'
        ),
      true
    ),
    updated_at=now()
where occurrence.id in (
  select qi.planned_occurrence_id
  from atlas.task_release_queue_items qi
  join atlas.farms f on f.id=qi.farm_id
  where f.stable_key='elm_farm'
    and qi.queue_key='anna_weeding_rotation'
    and qi.planned_occurrence_id is not null
    and qi.state in ('active','queued')
);