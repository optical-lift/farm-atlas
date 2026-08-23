-- Roll Atlas Owner/Worker feed behavior back to the production state immediately
-- before PRs #509/#510. This is a compensating rollback only; it does not
-- introduce the next scheduling architecture.

-- Stop and remove the readiness-escalation machinery introduced after the
-- approved checkpoint.
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='worker-task-readiness-escalations-v1' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
end $$;

delete from atlas.authenticated_rpc_registry
where signature='atlas.worker_executable_task_ids_v1(uuid,uuid,uuid[],date)';

drop function if exists atlas.sync_all_worker_task_readiness_escalations_v1();
drop function if exists atlas.sync_worker_task_readiness_escalations_v1(uuid,uuid,date,date);
drop function if exists atlas.worker_executable_task_ids_v1(uuid,uuid,uuid[],date);
drop function if exists atlas.roll_farm_round_forward_v1(uuid,date);

-- Restore the temporal resolver that was live before the Farm Round ordering
-- experiment.
create or replace function atlas.worker_task_day_window_v1(p_action_key text, p_task_type text, p_metadata jsonb)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_metadata->>'work_window_key','')) in ('morning','afternoon','evening')
      then lower(p_metadata->>'work_window_key')
    when lower(coalesce(p_metadata->>'daypart','')) in ('morning','afternoon','evening')
      then lower(p_metadata->>'daypart')
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('top','morning','upper','first') then 'morning'
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('midday','midday_flex','visibility','visibility_prep','anchored','afternoon') then 'afternoon'
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('evening','lower','bottom','last','last_thing') then 'evening'
    when lower(coalesce(p_action_key,'')) in ('sow','seed')
      or lower(coalesce(p_task_type,'')) in ('sowing','succession_sowing')
      or lower(coalesce(p_metadata->>'work_rhythm',''))='seed_sowing' then 'evening'
    when lower(coalesce(p_metadata->>'work_route',''))='seed' then 'evening'
    when lower(coalesce(p_action_key,''))='mow'
      or lower(coalesce(p_metadata->>'work_collection_key',''))='mowing' then 'evening'
    when lower(coalesce(p_action_key,'')) in ('plant','transplant')
      or lower(coalesce(p_task_type,''))='transplanting' then 'evening'
    when lower(coalesce(p_action_key,''))='weed'
      or lower(coalesce(p_metadata->>'work_collection_key',''))='weeding' then 'morning'
    when lower(coalesce(p_action_key,''))='harvest'
      or lower(coalesce(p_task_type,''))='postharvest' then 'morning'
    when lower(coalesce(p_action_key,''))='water'
      or lower(coalesce(p_task_type,'')) in ('grow_room_care','germination_check') then 'morning'
    else 'afternoon'
  end;
$$;

create or replace function atlas.worker_task_order_v1(p_action_key text,p_task_type text,p_metadata jsonb)
returns integer
language plpgsql
immutable
as $$
declare
  v_explicit integer;
  v_window text;
  v_day_order integer:=0;
begin
  begin
    v_explicit:=coalesce(
      nullif(p_metadata->>'day_work_order','')::integer,
      nullif(p_metadata->>'work_order','')::integer,
      nullif(p_metadata->>'day_order_override','')::integer,
      nullif(p_metadata->>'run_sheet_order','')::integer
    );
  exception when invalid_text_representation then
    v_explicit:=null;
  end;
  if v_explicit is not null then return v_explicit; end if;
  begin
    v_day_order:=greatest(0,least(coalesce(nullif(p_metadata->>'day_order','')::integer,0),999));
  exception when invalid_text_representation then
    v_day_order:=0;
  end;
  v_window:=atlas.worker_task_day_window_v1(p_action_key,p_task_type,p_metadata);
  return case v_window when 'morning' then 22000 when 'evening' then 76000 else 42000 end + v_day_order;
end;
$$;

-- Restore the calendar rollover implementation that was live at the checkpoint.
create or replace function atlas.roll_expired_worker_tasks_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_target_date date default null::date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $$
declare
  v_timezone text := 'America/Chicago';
  v_today date;
  v_target date;
  v_task record;
  v_destination date;
  v_existing_placement date;
  v_result jsonb;
  v_moved integer := 0;
  v_superseded integer := 0;
  v_expired_weekly_harvest integer := 0;
begin
  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone
  from atlas.farms f where f.id=p_farm_id;
  v_today := (now() at time zone v_timezone)::date;
  v_target := coalesce(p_target_date,v_today);
  if v_target < v_today then v_target := v_today; end if;
  v_target := atlas.worker_day_on_or_after_v1(p_farm_id,p_membership_id,v_target);
  if v_target is null then
    return jsonb_build_object('moved',0,'superseded',0,'expiredWeeklyHarvestRounds',0,'reason','no_available_worker_day');
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
    if coalesce(v_task.metadata->>'task_style','')='weekly_harvest_round'
       and lower(coalesce(v_task.metadata->>'completion_independent_schedule','false')) in ('true','yes','1')
    then
      perform atlas.record_task_transition_v1_internal(
        v_task.id,'changed_plan',left('calendar-rollover-expired-weekly-harvest:'||v_task.id::text||':'||v_task.due_date::text,160),
        null,null,'Weekly Harvest round expired on its scheduled day; it does not carry forward.',v_task.action_key,'calendar_rollover',
        jsonb_build_object('calendarRollover',false,'scheduledDate',v_task.due_date,'targetDate',v_target,'disposition','expired_weekly_harvest_round','taskStyle','weekly_harvest_round'),null
      );
      v_expired_weekly_harvest := v_expired_weekly_harvest + 1;
      continue;
    end if;

    if exists(
      select 1 from atlas.presented_work_selection_rows_unfiltered_v1(p_farm_id,p_membership_id,v_target) r
      where r.task_id=v_task.id and r.presentation_reason='superseded_rhythm_serving'
    ) then
      perform atlas.record_task_transition_v1_internal(
        v_task.id,'changed_plan',left('calendar-rollover-superseded:'||v_task.id::text||':'||v_target::text,160),
        null,null,null,v_task.action_key,'calendar_rollover',
        jsonb_build_object('calendarRollover',true,'closedFromDate',v_task.due_date,'targetDate',v_target,'disposition','superseded'),null
      );
      v_superseded := v_superseded + 1;
      continue;
    end if;

    select p.service_date into v_existing_placement
    from atlas.worker_day_task_placements p
    where p.task_id=v_task.id and p.state='placed' and p.service_date>=v_target
    limit 1;
    v_destination := coalesce(v_existing_placement,v_target);

    v_result := atlas.record_task_transition_v1_internal(
      v_task.id,'rescheduled',left('calendar-rollover:'||v_task.id::text||':'||v_destination::text,160),
      v_destination,null,null,v_task.action_key,'calendar_rollover',
      jsonb_build_object('calendarRollover',true,'closedFromDate',v_task.due_date,'targetDate',v_destination),null
    );

    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'calendar_rollover',true,'calendar_rollover_from',v_task.due_date,'calendar_rollover_to',v_destination,'calendar_rollover_at',now()
    ),updated_at=now()
    where id=v_task.id;

    update atlas.worker_day_task_placements p
    set service_date=v_destination,planned_start_at=null,updated_at=now()
    where p.task_id=v_task.id and p.state='placed' and p.service_date<v_destination;

    if v_task.planned_occurrence_id is not null then
      update atlas.planned_work_occurrences o
      set planned_due_date=v_destination,
          not_before_date=least(coalesce(o.not_before_date,v_destination),v_destination),
          task_payload=jsonb_set(coalesce(o.task_payload,'{}'::jsonb),'{due_date}',to_jsonb(v_destination),true),
          metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object(
            'calendarRollover',true,'calendarRolloverFrom',v_task.due_date,'calendarRolloverTo',v_destination,'calendarRolloverAt',now()
          ),updated_at=now()
      where o.id=v_task.planned_occurrence_id and o.state not in ('completed','cancelled');
    end if;

    v_moved := v_moved + 1;
  end loop;

  return jsonb_build_object('farmId',p_farm_id,'membershipId',p_membership_id,'targetDate',v_target,'moved',v_moved,'superseded',v_superseded,'expiredWeeklyHarvestRounds',v_expired_weekly_harvest);
end;
$$;

-- The readiness sync created Owner escalations after the checkpoint. Keep the
-- audit rows, but make them non-active so the rollback does not expose them.
update atlas.operational_escalations
set status='resolved',resolved_at=coalesce(resolved_at,now()),updated_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('rollbackCheckpoint','672de8320eea67a6416d52288708dbfc30f600b0')
where source_system='farm_clock'
  and source_type='worker_task_execution_readiness'
  and metadata->>'syncContract'='worker_task_execution_readiness_escalation_v1'
  and created_at>='2026-08-23 13:16:00+00'::timestamptz;

-- Clean post-checkpoint rollover markers from the tasks that were touched while
-- preserving the original 05:07 calendar-rollover state.
update atlas.tasks t
set metadata=(coalesce(t.metadata,'{}'::jsonb)
  -'calendar_rollover_review_required'
  -'calendar_rollover_review_from'
  -'calendar_rollover_review_target'
  -'calendar_rollover_review_marked_at'
  -'calendar_rollover_corrected'
  -'calendar_rollover_corrected_at'
  -'calendar_rollover_correction_reason'
  -'calendar_rollover_contract'),
  updated_at=now()
where exists(
  select 1 from atlas.task_transitions tr
  where tr.task_id=t.id
    and tr.created_at>='2026-08-23 13:16:00+00'::timestamptz
    and (tr.idempotency_key like 'undo-silent-rollover-20260823:%'
      or tr.idempotency_key like 'calendar-rollover-v1:%')
);

-- Restore the two stale-but-still-open tasks to the exact calendar state that
-- existed at the checkpoint. Their later disposition will be re-adjudicated in
-- a separate, user-approved cleanup phase.
update atlas.tasks
set status='open',completed_at=null,completed_by=null,due_date='2026-08-24'::date,
    metadata=(coalesce(metadata,'{}'::jsonb)-'last_transition'-'transition_count'),updated_at=now()
where id in (
  '7628fa29-d019-4d89-baa3-3535ed172f7f'::uuid,
  '10185495-7160-4065-a2aa-ab75251b60d5'::uuid
);

-- Restore the original Saturday Farm Round shell as the single carried card
-- that existed at the checkpoint, and retire only the duplicate shell created
-- by the post-checkpoint singleton experiment.
update atlas.tasks
set status='open',completed_at=null,completed_by=null,due_date='2026-08-24'::date,
    metadata=(coalesce(metadata,'{}'::jsonb)
      -'last_transition'-'transition_count'
      -'repair_reopened_for_rollover'-'repair_reopened_at'
      -'calendar_rollover_corrected'-'calendar_rollover_corrected_at'-'calendar_rollover_correction_reason'),
    updated_at=now()
where id='97654246-0518-4145-82f8-e88044fc6a1a'::uuid;

update atlas.planned_work_occurrences
set state='released',planned_due_date='2026-08-24'::date,
    task_payload=jsonb_set(coalesce(task_payload,'{}'::jsonb),'{due_date}',to_jsonb('2026-08-24'::date),true),
    metadata=(coalesce(metadata,'{}'::jsonb)
      -'terminal_at'-'terminal_task_id'-'terminal_task_status'
      -'farmRoundCarriedToDate'-'farmRoundCarriedIntoOccurrenceId'
      -'repairReopenedForRollover'-'active_task_due_date_sync'-'last_operational_reschedule')
      ||jsonb_build_object('calendarRollover',true,'calendarRolloverFrom','2026-08-22','calendarRolloverTo','2026-08-24','calendarRolloverAt','2026-08-23T05:07:00.057781+00:00'),
    updated_at=now()
where id='6b9ffe30-e548-47c3-9ca4-04a4a70894a0'::uuid;

update atlas.farm_round_occurrences
set status='open',parent_task_id='97654246-0518-4145-82f8-e88044fc6a1a'::uuid,
    metadata=(coalesce(metadata,'{}'::jsonb)-'carriedIntoOccurrenceId'-'carriedToDate'-'repairReopenedForRollover'),updated_at=now()
where parent_occurrence_id='6b9ffe30-e548-47c3-9ca4-04a4a70894a0'::uuid;

update atlas.tasks
set status='open',completed_at=null,completed_by=null,due_date='2026-08-22'::date,
    parent_task_id='97654246-0518-4145-82f8-e88044fc6a1a'::uuid,
    metadata=(coalesce(metadata,'{}'::jsonb)
      -'last_transition'-'transition_count'
      -'farm_round_carried_forward'-'farm_round_carried_to'
      -'repair_reopened_after_wrong_parent_close'-'repair_reopened_at')
      ||jsonb_build_object('farm_round_parent_occurrence_id','6b9ffe30-e548-47c3-9ca4-04a4a70894a0'),
    updated_at=now()
where id='ecdaafb2-9f58-45d7-89eb-1709523e9031'::uuid;

update atlas.planned_work_occurrences
set state='released',parent_occurrence_id='6b9ffe30-e548-47c3-9ca4-04a4a70894a0'::uuid,
    planned_due_date='2026-08-22'::date,
    metadata=(coalesce(metadata,'{}'::jsonb)
      -'terminal_at'-'terminal_task_id'-'terminal_task_status'
      -'farmRoundCarriedToDate'-'farmRoundCarriedForward'
      -'farmRoundCarriedToOccurrenceId'-'farmRoundCarriedFromOccurrenceId'
      -'repairReopenedAfterWrongParentClose'-'active_task_due_date_sync'-'last_operational_reschedule')
      ||jsonb_build_object('farmRoundParentOccurrenceId','6b9ffe30-e548-47c3-9ca4-04a4a70894a0'),
    task_payload=jsonb_set(
      jsonb_set(coalesce(task_payload,'{}'::jsonb),'{due_date}',to_jsonb('2026-08-22'::date),true),
      '{metadata,farm_round_parent_occurrence_id}',to_jsonb('6b9ffe30-e548-47c3-9ca4-04a4a70894a0'::text),true
    ),
    updated_at=now()
where id='468e9448-3efe-420d-af30-f7ca69ca861c'::uuid;

update atlas.tasks
set status='archived',completed_at=null,completed_by=null,updated_at=now()
where id in (
  'ae50601b-c70e-4082-a84f-8eb0708e3c05'::uuid,
  '842a1485-436d-44ec-9ee2-845797e8625f'::uuid
);

update atlas.planned_work_occurrences
set state='cancelled',updated_at=now()
where id in (
  '47cfd6fe-049a-4720-803e-7bd220ed6c3c'::uuid,
  '771c0fdd-924a-4004-b360-2da767215dff'::uuid
);

update atlas.farm_round_occurrences
set status='cancelled',updated_at=now()
where parent_occurrence_id='47cfd6fe-049a-4720-803e-7bd220ed6c3c'::uuid;

-- Restore Rainbow Swiss chard to its pre-MG5 state from the preserved work
-- occurrence snapshot. The later MG5 claims are cancelled, not erased.
update atlas.crop_destination_claims
set status='cancelled',released_at=coalesce(released_at,now()),updated_at=now(),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('rollbackCheckpoint','672de8320eea67a6416d52288708dbfc30f600b0')
where idempotency_key like 'rainbow-chard-mg5-20260823:%';

update atlas.tasks
set zone_id='91602b6e-3e8e-4e67-b9fb-bfb01e56fe2f'::uuid,
    metadata=(coalesce(metadata,'{}'::jsonb)
      -'destination_object_id'-'transplant_destination_object_id'-'destination_label'
      -'display_location'-'destination_assigned_by_owner'-'destination_assigned_on'
      -'calendar_rollover_contract'-'calendar_rollover_corrected'-'calendar_rollover_corrected_at'-'calendar_rollover_correction_reason')
      ||jsonb_build_object('transplant_destination','Choose final garden placement at transplant time'),
    updated_at=now()
where id='581eacf6-17ef-480b-ba52-0f68374621e4'::uuid;

update atlas.tasks
set status='open',completed_at=null,completed_by=null,
    metadata=(coalesce(metadata,'{}'::jsonb)-'last_transition'-'transition_count'),updated_at=now()
where id='85622abd-f83a-413a-9eac-713e210f678f'::uuid;

update atlas.planned_work_occurrences
set state='released',
    metadata=(coalesce(metadata,'{}'::jsonb)-'terminal_at'-'terminal_task_id'-'terminal_task_status'),
    updated_at=now()
where id='54e367c7-1ca1-4438-bbe5-3dfb4d90caa3'::uuid;
