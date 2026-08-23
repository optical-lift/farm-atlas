create or replace function atlas.worker_executable_task_ids_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_ids uuid[],
  p_day date default null
)
returns table(task_id uuid)
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_user_id uuid;
  v_target_user_id uuid;
begin
  v_user_id := auth.uid();
  select fm.user_id into v_target_user_id
  from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;

  if v_target_user_id is null then
    raise exception 'Target membership is not active on this farm.' using errcode='42501';
  end if;

  if v_user_id is not null
     and v_user_id is distinct from v_target_user_id
     and not atlas.is_farm_manager_or_owner(p_farm_id) then
    raise exception 'Only farm management may inspect another worker readiness set.' using errcode='42501';
  end if;

  return query
  select t.id
  from atlas.tasks t
  where t.farm_id=p_farm_id
    and t.id=any(coalesce(p_task_ids,array[]::uuid[]))
    and (
      t.status not in ('open','blocked')
      or coalesce((atlas.task_execution_readiness_v1(t.id)->>'ready')::boolean,false)=true
    );
end;
$$;

revoke all on function atlas.worker_executable_task_ids_v1(uuid,uuid,uuid[],date) from public, anon;
grant execute on function atlas.worker_executable_task_ids_v1(uuid,uuid,uuid[],date) to authenticated, service_role;

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
  v_moved integer := 0;
  v_expired integer := 0;
  v_held_for_review integer := 0;
begin
  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone
  from atlas.farms f where f.id=p_farm_id;
  v_today := (now() at time zone v_timezone)::date;
  v_target := coalesce(p_target_date,v_today);
  if v_target < v_today then v_target := v_today; end if;
  v_target := atlas.worker_day_on_or_after_v1(p_farm_id,p_membership_id,v_target);
  if v_target is null then
    return jsonb_build_object('moved',0,'expired',0,'heldForOwnerReview',0,'reason','no_available_worker_day');
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
    if (coalesce(v_task.metadata->>'task_style','')='weekly_harvest_round'
        and lower(coalesce(v_task.metadata->>'completion_independent_schedule','false')) in ('true','yes','1'))
       or v_task.task_type='stewardship_round'
       or exists(
         select 1
         from atlas.presented_work_selection_rows_unfiltered_v1(p_farm_id,p_membership_id,v_target) r
         where r.task_id=v_task.id and r.presentation_reason='superseded_rhythm_serving'
       )
    then
      perform atlas.record_task_transition_v1_internal(
        v_task.id,
        'changed_plan',
        left('calendar-expired:'||v_task.id::text||':'||v_task.due_date::text,160),
        null,
        null,
        'This dated serving expired; it does not silently carry into a later Worker Day.',
        v_task.action_key,
        'calendar_rollover',
        jsonb_build_object('calendarRollover',false,'scheduledDate',v_task.due_date,'targetDate',v_target,'disposition','expired_dated_serving'),
        null
      );
      v_expired := v_expired + 1;
      continue;
    end if;

    if lower(coalesce(v_task.metadata->>'calendar_rollover_policy','')) in ('carry_forward','carry','true') then
      select p.service_date into v_existing_placement
      from atlas.worker_day_task_placements p
      where p.task_id=v_task.id and p.state='placed' and p.service_date>=v_target
      order by p.service_date
      limit 1;
      v_destination := coalesce(v_existing_placement,v_target);

      perform atlas.record_task_transition_v1_internal(
        v_task.id,
        'rescheduled',
        left('calendar-rollover-explicit:'||v_task.id::text||':'||v_destination::text,160),
        v_destination,
        null,
        'Explicit carry-forward policy moved this task to the next Worker Day.',
        v_task.action_key,
        'calendar_rollover',
        jsonb_build_object('calendarRollover',true,'closedFromDate',v_task.due_date,'targetDate',v_destination,'policy','explicit_carry_forward'),
        null
      );
      v_moved := v_moved + 1;
    else
      update atlas.tasks
      set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'calendar_rollover_review_required',true,
        'calendar_rollover_review_from',v_task.due_date,
        'calendar_rollover_review_target',v_target,
        'calendar_rollover_review_marked_at',now()
      ),updated_at=now()
      where id=v_task.id
        and lower(coalesce(metadata->>'calendar_rollover_review_required','false'))<>'true';
      v_held_for_review := v_held_for_review + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'contractVersion','worker_calendar_rollover_explicit_v2',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'targetDate',v_target,
    'moved',v_moved,
    'expired',v_expired,
    'heldForOwnerReview',v_held_for_review
  );
end;
$$;

create or replace function atlas.sync_worker_task_readiness_escalations_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_start_date date default null,
  p_end_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_timezone text := 'America/Chicago';
  v_start date;
  v_end date;
  v_principal_id uuid;
  v_task record;
  v_readiness jsonb;
  v_kind text;
  v_decision text;
  v_seen uuid[] := array[]::uuid[];
  v_opened integer := 0;
  v_resolved integer := 0;
begin
  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago') into v_timezone
  from atlas.farms f where f.id=p_farm_id;
  v_start := coalesce(p_start_date,(now() at time zone v_timezone)::date);
  v_end := coalesce(p_end_date,v_start+14);

  select p.id into v_principal_id
  from atlas.farm_memberships fm
  join atlas.principals p on p.user_id=fm.user_id and p.status='active'
  where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner'
  order by fm.created_at,p.created_at
  limit 1;

  if v_principal_id is null then
    return jsonb_build_object('opened',0,'resolved',0,'reason','no_active_farm_principal');
  end if;

  for v_task in
    select t.id,t.title,t.task_type,t.due_date
    from atlas.tasks t
    where t.farm_id=p_farm_id
      and t.assigned_membership_id=p_membership_id
      and t.task_scope='farm_operation'
      and t.status='open'
      and t.due_date is not null
      and t.due_date<=v_end
      and t.parent_task_id is null
      and nullif(t.metadata->>'parent_task_id','') is null
      and lower(coalesce(t.metadata->>'is_child_task','false'))<>'true'
    order by t.due_date,t.id
  loop
    v_readiness := atlas.task_execution_readiness_v1(v_task.id);
    if coalesce((v_readiness->>'ready')::boolean,false)=true then
      continue;
    end if;

    v_seen := array_append(v_seen,v_task.id);
    if coalesce((v_readiness#>>'{destination,ready}')::boolean,true)=false then
      v_kind := 'destination';
      v_decision := 'Choose or confirm a canonical destination for '||v_task.title||'.';
    elsif coalesce((v_readiness->>'resourcesReady')::boolean,true)=false then
      v_kind := 'resource';
      v_decision := 'Resolve the required equipment or supplies for '||v_task.title||'.';
    elsif coalesce((v_readiness->>'prerequisitesReady')::boolean,true)=false then
      v_kind := 'prerequisite';
      v_decision := 'Resolve the prerequisite blocking '||v_task.title||'.';
    else
      v_kind := 'readiness';
      v_decision := 'Resolve the missing execution readiness for '||v_task.title||'.';
    end if;

    perform atlas.record_operational_escalation_v1(
      v_principal_id,
      jsonb_build_object(
        'sourceSystem','farm_clock',
        'sourceType','worker_task_execution_readiness',
        'sourceId',v_task.id::text,
        'escalationKind','missing_critical_information',
        'currentState',jsonb_build_object(
          'taskId',v_task.id,
          'taskTitle',v_task.title,
          'taskType',v_task.task_type,
          'dueDate',v_task.due_date,
          'workerMembershipId',p_membership_id,
          'readinessKind',v_kind,
          'readiness',v_readiness
        ),
        'thresholdCrossed','Worker work is inside the planning horizon but lacks an execution warrant.',
        'consequence','The task is withheld from the worker execution feed until the missing readiness is resolved.',
        'ownerDecisionRequired',v_decision,
        'options',jsonb_build_array('resolve_'||v_kind),
        'severity','material',
        'floorClass',5,
        'protectionLevel','protected',
        'interruptibility','interruptible',
        'reasonForFloor','Delegated work requires an Owner-visible intervention before a worker may execute it.',
        'expectedOwnerMinutes',5,
        'horizon','H1',
        'metadata',jsonb_build_object(
          'farmId',p_farm_id,
          'membershipId',p_membership_id,
          'taskId',v_task.id,
          'syncContract','worker_task_execution_readiness_escalation_v1'
        )
      )
    );
    v_opened := v_opened + 1;
  end loop;

  update atlas.operational_escalations e
  set status='resolved',resolved_at=now(),updated_at=now(),
      metadata=coalesce(e.metadata,'{}'::jsonb)||jsonb_build_object('resolutionReason','execution_ready_or_task_closed','resolvedAt',now())
  where e.principal_id=v_principal_id
    and e.source_system='farm_clock'
    and e.source_type='worker_task_execution_readiness'
    and e.escalation_kind='missing_critical_information'
    and e.status='open'
    and e.metadata->>'farmId'=p_farm_id::text
    and e.metadata->>'membershipId'=p_membership_id::text
    and not (e.source_id::uuid=any(v_seen));
  get diagnostics v_resolved = row_count;

  return jsonb_build_object('contractVersion','worker_task_execution_readiness_escalation_v1','openedOrRefreshed',v_opened,'resolved',v_resolved,'startDate',v_start,'endDate',v_end);
end;
$$;

create or replace function atlas.sync_all_worker_task_readiness_escalations_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  r record;
  v_results jsonb := '[]'::jsonb;
begin
  for r in
    select fm.farm_id,fm.id membership_id
    from atlas.farm_memberships fm
    where fm.active=true and fm.role='farm_hand'
    order by fm.farm_id,fm.id
  loop
    v_results := v_results || jsonb_build_array(atlas.sync_worker_task_readiness_escalations_v1(r.farm_id,r.membership_id,null,null));
  end loop;
  return jsonb_build_object('contractVersion','worker_task_execution_readiness_escalation_tick_v1','ranAt',now(),'workers',v_results);
end;
$$;

revoke all on function atlas.sync_worker_task_readiness_escalations_v1(uuid,uuid,date,date) from public, anon, authenticated;
revoke all on function atlas.sync_all_worker_task_readiness_escalations_v1() from public, anon, authenticated;
grant execute on function atlas.sync_worker_task_readiness_escalations_v1(uuid,uuid,date,date) to service_role;
grant execute on function atlas.sync_all_worker_task_readiness_escalations_v1() to service_role;

do $$
begin
  if not exists(select 1 from cron.job where jobname='worker-task-readiness-escalations-v1') then
    perform cron.schedule('worker-task-readiness-escalations-v1','12 * * * *','select atlas.sync_all_worker_task_readiness_escalations_v1();');
  end if;
end $$;

-- Undo only the Aug. 23 automatic Aug. 22 -> Aug. 24 rollover batch when no explicit Aug. 24 placement protects it.
do $$
declare r record;
begin
  for r in
    select tr.task_id,tr.previous_due_date
    from atlas.task_transitions tr
    join atlas.tasks t on t.id=tr.task_id
    join atlas.farms f on f.id=t.farm_id and f.stable_key='elm_farm'
    where tr.transition='rescheduled'
      and tr.previous_due_date='2026-08-22'::date
      and tr.target_date='2026-08-24'::date
      and tr.created_at='2026-08-23 05:07:00.057781+00'::timestamptz
      and not exists(
        select 1 from atlas.worker_day_task_placements p
        where p.task_id=tr.task_id and p.state='placed' and p.service_date='2026-08-24'::date
      )
      and t.status='open'
  loop
    perform atlas.record_task_transition_v1_internal(
      r.task_id,'rescheduled',left('undo-silent-rollover-20260823:'||r.task_id::text,160),r.previous_due_date,
      null,'Undo silent calendar rollover; expired work requires explicit carry-forward or Owner review.',null,'calendar_rollover_repair',
      jsonb_build_object('calendarRolloverCorrection',true,'incorrectTargetDate','2026-08-24','restoredDate',r.previous_due_date),null
    );
    update atlas.tasks set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'calendar_rollover_corrected',true,
      'calendar_rollover_corrected_at',now(),
      'calendar_rollover_correction_reason','silent_carry_forward_removed'
    ) where id=r.task_id;
  end loop;
end $$;

-- Retire three dated commitments the Owner has now explicitly declared stale/expired.
do $$
declare r record;
begin
  for r in
    select t.id,t.metadata->>'task_key' task_key
    from atlas.tasks t
    join atlas.farms f on f.id=t.farm_id and f.stable_key='elm_farm'
    where t.status in ('open','blocked')
      and t.metadata->>'task_key' in (
        'anna_20260805_school_preschool_enrollment',
        'anna_20260814_upload_friday_farm_posy_photos_icloud',
        'anna_farm_round_20260822'
      )
  loop
    perform atlas.record_task_transition_v1_internal(
      r.id,'changed_plan',left('owner-stale-20260823:'||r.task_key,160),null,null,
      case r.task_key
        when 'anna_20260805_school_preschool_enrollment' then 'Enrollment window is over; do not carry this task forward.'
        when 'anna_20260814_upload_friday_farm_posy_photos_icloud' then 'Friday Farm posy request is stale; the flowers are no longer available.'
        else 'This dated Farm Round occurrence expired; a later Farm Round is a separate occurrence.'
      end,
      null,'owner_reconciliation',jsonb_build_object('ownerReconciled',true,'reconciledOn','2026-08-23'),null
    );
  end loop;
end $$;

select atlas.sync_all_worker_task_readiness_escalations_v1();
