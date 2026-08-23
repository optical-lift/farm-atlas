create or replace function atlas.roll_expired_worker_tasks_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_target_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_timezone text := 'America/Chicago';
  v_today date;
  v_target date;
  v_task record;
  v_destination date;
  v_existing_placement date;
  v_round_result jsonb;
  v_moved integer := 0;
  v_rounds_carried integer := 0;
begin
  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone
  from atlas.farms f where f.id=p_farm_id;
  v_today := (now() at time zone v_timezone)::date;
  v_target := coalesce(p_target_date,v_today);
  if v_target < v_today then v_target := v_today; end if;
  v_target := atlas.worker_day_on_or_after_v1(p_farm_id,p_membership_id,v_target);
  if v_target is null then
    return jsonb_build_object('moved',0,'farmRoundsCarried',0,'reason','no_available_worker_day');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text||':'||p_membership_id::text||':calendar-rollover',0));

  for v_task in
    select t.*
    from atlas.tasks t
    where t.farm_id=p_farm_id
      and t.assigned_membership_id=p_membership_id
      and t.task_scope='farm_operation'
      and t.status='open'
      and t.due_date is not null
      and t.due_date<v_target
      and t.parent_task_id is null
      and nullif(t.metadata->>'parent_task_id','') is null
      and lower(coalesce(t.metadata->>'is_child_task','false'))<>'true'
      and coalesce(t.visibility_scope,'')<>'system_internal'
    order by t.due_date,t.created_at,t.id
    for update
  loop
    if v_task.task_type='stewardship_round' or lower(coalesce(v_task.action_key,''))='farm_round' then
      v_round_result := atlas.roll_farm_round_forward_v1(v_task.id,v_target);
      if coalesce(v_round_result->>'state','') in ('carried_into_current_round','rescheduled_existing_round','rescheduled_without_occurrence') then
        v_rounds_carried := v_rounds_carried+1;
      end if;
      continue;
    end if;

    select p.service_date into v_existing_placement
    from atlas.worker_day_task_placements p
    where p.task_id=v_task.id and p.state='placed' and p.service_date>=v_target
    order by p.service_date
    limit 1;
    v_destination := coalesce(v_existing_placement,v_target);

    perform atlas.record_task_transition_v1_internal(
      v_task.id,
      'rescheduled',
      left('calendar-rollover-v1:'||v_task.id::text||':'||v_destination::text,160),
      v_destination,
      null,
      'Unfinished work moved to the next worker day.',
      v_task.action_key,
      'calendar_rollover',
      jsonb_build_object('calendarRollover',true,'closedFromDate',v_task.due_date,'targetDate',v_destination,'policy','unfinished_work_carries_forward'),
      null
    );
    update atlas.tasks
    set metadata=(coalesce(metadata,'{}'::jsonb)-'calendar_rollover_review_required'-'calendar_rollover_review_from'-'calendar_rollover_review_target'-'calendar_rollover_review_marked_at')
        ||jsonb_build_object('calendar_rollover_contract','unfinished_work_carries_forward_v1'),
        updated_at=now()
    where id=v_task.id;
    v_moved := v_moved+1;
  end loop;

  return jsonb_build_object(
    'contractVersion','unfinished_work_carries_forward_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'targetDate',v_target,
    'moved',v_moved,
    'farmRoundsCarried',v_rounds_carried
  );
end;
$$;

-- Repair the Saturday Farm Round member that was incorrectly closed when the
-- parent shell was archived by the superseded rollover rule. The completed
-- chicken chore stays historical; the unfinished indoor-watering act joins the
-- Monday Farm Round and remains one current act.
do $$
declare
  v_farm_id uuid;
  v_membership_id uuid;
  v_parent_task_id uuid;
  v_parent_occurrence_id uuid;
  v_water_task_id uuid;
  v_water_occurrence_id uuid;
begin
  select f.id into v_farm_id from atlas.farms f where f.stable_key='elm_farm' limit 1;
  select fm.id into v_membership_id
  from atlas.farm_memberships fm
  where fm.farm_id=v_farm_id and fm.active=true and fm.worker_key='anna'
  order by fm.created_at limit 1;

  select t.id,t.planned_occurrence_id into v_parent_task_id,v_parent_occurrence_id
  from atlas.tasks t
  where t.farm_id=v_farm_id and t.metadata->>'task_key'='anna_farm_round_20260822'
  order by t.created_at desc limit 1;

  select t.id,t.planned_occurrence_id into v_water_task_id,v_water_occurrence_id
  from atlas.tasks t
  where t.farm_id=v_farm_id
    and t.parent_task_id=v_parent_task_id
    and coalesce(t.task_series_key,t.metadata->>'task_series_key')='anna_water_indoor_plants_saturday'
  order by t.created_at desc limit 1;

  if v_parent_task_id is not null and v_water_task_id is not null
     and exists(
       select 1 from atlas.task_transitions tt
       where tt.task_id=v_water_task_id
         and tt.transition='changed_plan'
         and tt.reason='Parent task closed.'
         and tt.created_at::date='2026-08-23'::date
     )
  then
    update atlas.tasks
    set status='open',completed_at=null,completed_by=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'repair_reopened_after_wrong_parent_close',true,
          'repair_reopened_at',now(),
          'repair_reason','Saturday Farm Round is a rolling singleton; unfinished member must carry to Monday.'
        ),updated_at=now()
    where id=v_water_task_id;

    update atlas.planned_work_occurrences
    set state='released',released_task_id=v_water_task_id,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('repairReopenedAfterWrongParentClose',true),updated_at=now()
    where id=v_water_occurrence_id;

    update atlas.tasks
    set status='open',completed_at=null,completed_by=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('repair_reopened_for_rollover',true,'repair_reopened_at',now()),updated_at=now()
    where id=v_parent_task_id;

    update atlas.planned_work_occurrences
    set state='released',released_task_id=v_parent_task_id,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('repairReopenedForRollover',true),updated_at=now()
    where id=v_parent_occurrence_id;

    update atlas.farm_round_occurrences
    set status='open',parent_task_id=v_parent_task_id,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('repairReopenedForRollover',true),updated_at=now()
    where parent_occurrence_id=v_parent_occurrence_id;

    perform atlas.roll_farm_round_forward_v1(v_parent_task_id,'2026-08-24'::date);
  end if;

  if v_membership_id is not null then
    perform atlas.roll_expired_worker_tasks_v1(v_farm_id,v_membership_id,'2026-08-24'::date);
  end if;
end $$;
