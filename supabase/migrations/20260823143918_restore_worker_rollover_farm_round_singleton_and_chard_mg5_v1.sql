create or replace function atlas.roll_farm_round_forward_v1(
  p_task_id uuid,
  p_target_date date
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_old_occurrence_id uuid;
  v_target_occurrence_id uuid;
  v_target_task_id uuid;
  v_target_result jsonb;
  v_member record;
  v_duplicate_occurrence_id uuid;
  v_duplicate_task_id uuid;
  v_series_key text;
  v_open_members integer := 0;
  v_carried_members integer := 0;
  v_deduped_members integer := 0;
begin
  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then
    raise exception 'Farm Round task was not found.' using errcode='P0002';
  end if;
  if v_task.task_type <> 'stewardship_round' and lower(coalesce(v_task.action_key,'')) <> 'farm_round' then
    raise exception 'Task is not a Farm Round.' using errcode='22023';
  end if;
  if v_task.status <> 'open' then
    return jsonb_build_object('state','terminal','taskId',v_task.id,'status',v_task.status);
  end if;

  begin
    v_old_occurrence_id := nullif(v_task.metadata->>'planned_occurrence_id','')::uuid;
  exception when others then
    v_old_occurrence_id := v_task.planned_occurrence_id;
  end;
  v_old_occurrence_id := coalesce(v_old_occurrence_id,v_task.planned_occurrence_id);

  if v_old_occurrence_id is null then
    perform atlas.record_task_transition_v1_internal(
      v_task.id,'rescheduled',left('farm-round-roll:'||v_task.id::text||':'||p_target_date::text,160),p_target_date,
      null,'Unfinished Farm Round moved to the next worker day.',v_task.action_key,'calendar_rollover',
      jsonb_build_object('calendarRollover',true,'farmRoundCarryForward',true,'targetDate',p_target_date),null
    );
    return jsonb_build_object('state','rescheduled_without_occurrence','taskId',v_task.id,'targetDate',p_target_date);
  end if;

  perform atlas.reconcile_farm_round_completion_v1(v_old_occurrence_id);
  select status into v_task.status from atlas.tasks where id=p_task_id;
  if v_task.status <> 'open' then
    return jsonb_build_object('state','already_terminal_after_reconcile','taskId',p_task_id,'status',v_task.status);
  end if;

  select count(*) into v_open_members
  from atlas.planned_work_occurrences
  where parent_occurrence_id=v_old_occurrence_id
    and state not in ('completed','cancelled');

  if v_open_members=0 then
    perform atlas.reconcile_farm_round_completion_v1(v_old_occurrence_id);
    return jsonb_build_object('state','completed_no_carry','taskId',p_task_id,'targetDate',p_target_date);
  end if;

  perform atlas.ensure_farm_round_for_date_v1(v_task.farm_id,v_task.assigned_membership_id,p_target_date);

  select fro.parent_occurrence_id into v_target_occurrence_id
  from atlas.farm_round_occurrences fro
  where fro.farm_id=v_task.farm_id
    and fro.assigned_membership_id=v_task.assigned_membership_id
    and fro.service_date=p_target_date
    and fro.status<>'cancelled'
  order by fro.updated_at desc
  limit 1;

  if v_target_occurrence_id is null or v_target_occurrence_id=v_old_occurrence_id then
    perform atlas.record_task_transition_v1_internal(
      v_task.id,'rescheduled',left('farm-round-roll:'||v_task.id::text||':'||p_target_date::text,160),p_target_date,
      null,'Unfinished Farm Round moved to the next worker day.',v_task.action_key,'calendar_rollover',
      jsonb_build_object('calendarRollover',true,'farmRoundCarryForward',true,'targetDate',p_target_date),null
    );
    update atlas.planned_work_occurrences
    set planned_due_date=p_target_date,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('farmRoundCarriedForward',true,'farmRoundCarriedTo',p_target_date),
        updated_at=now()
    where id=v_old_occurrence_id;
    return jsonb_build_object('state','rescheduled_existing_round','taskId',p_task_id,'targetDate',p_target_date);
  end if;

  v_target_result := atlas.materialize_specific_work_occurrence_v1(v_target_occurrence_id,p_target_date);
  v_target_task_id := nullif(v_target_result->>'taskId','')::uuid;
  if v_target_task_id is null then
    select released_task_id into v_target_task_id from atlas.planned_work_occurrences where id=v_target_occurrence_id;
  end if;

  for v_member in
    select o.*
    from atlas.planned_work_occurrences o
    where o.parent_occurrence_id=v_old_occurrence_id
      and o.state not in ('completed','cancelled')
    order by o.id
    for update
  loop
    v_series_key := coalesce(v_member.task_payload->>'task_series_key',v_member.task_payload->'metadata'->>'task_series_key');
    v_duplicate_occurrence_id := null;
    v_duplicate_task_id := null;

    if nullif(v_series_key,'') is not null then
      select o.id,o.released_task_id
      into v_duplicate_occurrence_id,v_duplicate_task_id
      from atlas.planned_work_occurrences o
      where o.parent_occurrence_id=v_target_occurrence_id
        and o.id<>v_member.id
        and o.state<>'cancelled'
        and coalesce(o.task_payload->>'task_series_key',o.task_payload->'metadata'->>'task_series_key')=v_series_key
      order by case when o.state='completed' then 1 else 0 end,o.created_at,o.id
      limit 1;
    end if;

    if v_duplicate_occurrence_id is not null then
      if v_duplicate_task_id is not null and exists(
        select 1 from atlas.tasks where id=v_duplicate_task_id and status in ('open','blocked')
      ) then
        perform atlas.record_task_transition_v1_internal(
          v_duplicate_task_id,'changed_plan',left('farm-round-dedupe:'||v_duplicate_occurrence_id::text||':'||p_target_date::text,160),
          null,null,'An unfinished stewardship act already carried into this Farm Round; do not create a duplicate.',
          null,'farm_round_rollover',jsonb_build_object('supersededByCarryoverOccurrenceId',v_member.id,'targetDate',p_target_date),null
        );
      end if;
      update atlas.planned_work_occurrences
      set state='cancelled',
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('farmRoundDuplicateSuppressed',true,'supersededByCarryoverOccurrenceId',v_member.id),
          updated_at=now()
      where id=v_duplicate_occurrence_id and state<>'completed';
      v_deduped_members := v_deduped_members+1;
    end if;

    update atlas.planned_work_occurrences
    set parent_occurrence_id=v_target_occurrence_id,
        planned_due_date=p_target_date,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'farmRoundCarriedForward',true,
          'farmRoundCarriedFromOccurrenceId',v_old_occurrence_id,
          'farmRoundCarriedToOccurrenceId',v_target_occurrence_id,
          'farmRoundCarriedToDate',p_target_date
        ),
        updated_at=now()
    where id=v_member.id;

    if v_member.released_task_id is not null then
      if exists(select 1 from atlas.tasks where id=v_member.released_task_id and status='open') then
        perform atlas.record_task_transition_v1_internal(
          v_member.released_task_id,'rescheduled',left('farm-round-member-roll:'||v_member.released_task_id::text||':'||p_target_date::text,160),p_target_date,
          null,'Unfinished Farm Round item moved to the next worker day.',null,'farm_round_rollover',
          jsonb_build_object('calendarRollover',true,'farmRoundCarryForward',true,'targetDate',p_target_date),null
        );
      end if;
      if v_target_task_id is not null then
        update atlas.tasks
        set parent_task_id=v_target_task_id,
            metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
              'farm_round_parent_occurrence_id',v_target_occurrence_id,
              'farm_round_carried_forward',true,
              'farm_round_carried_to',p_target_date
            ),
            updated_at=now()
        where id=v_member.released_task_id and status in ('open','blocked');
      end if;
    end if;
    v_carried_members := v_carried_members+1;
  end loop;

  perform atlas.record_task_transition_v1_internal(
    v_task.id,'changed_plan',left('farm-round-parent-carried:'||v_task.id::text||':'||p_target_date::text,160),
    null,null,'Farm Round shell carried forward into the next worker-day Farm Round.',v_task.action_key,'farm_round_rollover',
    jsonb_build_object('carriedIntoOccurrenceId',v_target_occurrence_id,'carriedIntoTaskId',v_target_task_id,'targetDate',p_target_date),null
  );

  update atlas.planned_work_occurrences
  set state='cancelled',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('farmRoundCarriedIntoOccurrenceId',v_target_occurrence_id,'farmRoundCarriedToDate',p_target_date),
      updated_at=now()
  where id=v_old_occurrence_id;

  update atlas.farm_round_occurrences
  set status='cancelled',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('carriedIntoOccurrenceId',v_target_occurrence_id,'carriedToDate',p_target_date),
      updated_at=now()
  where parent_occurrence_id=v_old_occurrence_id;

  update atlas.farm_round_occurrences
  set status='open',parent_task_id=coalesce(parent_task_id,v_target_task_id),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('receivedCarryover',true,'carriedFromOccurrenceId',v_old_occurrence_id),
      updated_at=now()
  where parent_occurrence_id=v_target_occurrence_id;

  perform atlas.materialize_farm_round_members_v1(v_target_occurrence_id,p_target_date);
  perform atlas.refresh_farm_round_preview_v1(v_target_occurrence_id);
  perform atlas.reconcile_farm_round_completion_v1(v_target_occurrence_id);

  return jsonb_build_object(
    'state','carried_into_current_round',
    'fromTaskId',p_task_id,
    'targetTaskId',v_target_task_id,
    'targetOccurrenceId',v_target_occurrence_id,
    'targetDate',p_target_date,
    'carriedMembers',v_carried_members,
    'dedupedMembers',v_deduped_members
  );
end;
$$;

revoke all on function atlas.roll_farm_round_forward_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.roll_farm_round_forward_v1(uuid,date) to service_role;

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
      left('calendar-rollover:'||v_task.id::text||':'||v_destination::text,160),
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

  if lower(coalesce(p_action_key,''))='farm_round'
     or lower(coalesce(p_task_type,''))='stewardship_round'
     or lower(coalesce(p_metadata->>'work_route',''))='farm_round' then
    return 21000;
  end if;

  begin
    v_day_order:=greatest(0,least(coalesce(nullif(p_metadata->>'day_order','')::integer,0),999));
  exception when invalid_text_representation then
    v_day_order:=0;
  end;
  v_window:=atlas.worker_task_day_window_v1(p_action_key,p_task_type,p_metadata);
  return case v_window when 'morning' then 22000 when 'evening' then 76000 else 42000 end + v_day_order;
end;
$$;

comment on function atlas.worker_task_order_v1(text,text,jsonb) is
  'Canonical Worker Day ordering. Farm Round is the first morning execution card unless an explicit owner-authored order overrides it.';

do $$
declare
  v_farm_id uuid;
  v_mg5_id uuid;
  v_mg5_zone_id uuid;
  v_task_id uuid;
  v_due_date date;
  v_cycle record;
  v_required numeric;
  v_resolution_task_id uuid;
begin
  select id into v_farm_id from atlas.farms where stable_key='elm_farm' limit 1;
  select id,zone_id into v_mg5_id,v_mg5_zone_id
  from atlas.growing_objects
  where farm_id=v_farm_id and stable_key='mg5'
  limit 1;

  select id,due_date into v_task_id,v_due_date
  from atlas.tasks
  where farm_id=v_farm_id
    and metadata->>'task_key'='transplant_rainbow_chard_20260714'
    and status='open'
  order by created_at desc
  limit 1;

  if v_task_id is not null and v_mg5_id is not null then
    for v_cycle in
      select distinct cc.id
      from atlas.crop_cycles cc
      where cc.farm_id=v_farm_id
        and cc.lifecycle_status='active'
        and cc.id in (
          select x.raw::uuid
          from atlas.tasks t,
               lateral jsonb_array_elements_text(case when jsonb_typeof(t.metadata->'crop_cycle_ids')='array' then t.metadata->'crop_cycle_ids' else '[]'::jsonb end) x(raw)
          where t.id=v_task_id
            and x.raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        )
    loop
      v_required := nullif(atlas.crop_destination_claim_coverage_v1(v_cycle.id)->>'requiredMoveQuantity','')::numeric;
      perform atlas.record_crop_destination_claim_v1(
        v_cycle.id,
        v_mg5_id,
        coalesce(v_required,1),
        'plants',
        coalesce(v_due_date,'2026-08-24'::date),
        'committed',
        'management',
        'Owner assigned Rainbow Swiss chard seedlings to MG5.',
        v_task_id,
        'owner_instruction',
        jsonb_build_object('instruction','Plant Rainbow Swiss chard in MG5','recordedOn','2026-08-23'),
        'rainbow-chard-mg5-20260823:'||v_cycle.id::text
      );
    end loop;

    update atlas.tasks
    set zone_id=v_mg5_zone_id,
        metadata=(coalesce(metadata,'{}'::jsonb)-'calendar_rollover_review_required'-'calendar_rollover_review_from'-'calendar_rollover_review_target'-'calendar_rollover_review_marked_at')
          ||jsonb_build_object(
            'destination_object_id',v_mg5_id,
            'transplant_destination_object_id',v_mg5_id,
            'transplant_destination','MG5',
            'destination_label','MG5',
            'display_location','MG5',
            'destination_assigned_by_owner',true,
            'destination_assigned_on','2026-08-23'
          ),
        updated_at=now()
    where id=v_task_id;

    select id into v_resolution_task_id
    from atlas.tasks
    where farm_id=v_farm_id
      and task_type='spatial_destination_resolution'
      and metadata->>'source_task_id'=v_task_id::text
      and status in ('open','blocked')
    order by created_at desc
    limit 1;

    if v_resolution_task_id is not null then
      perform atlas.record_task_transition_v1_internal(
        v_resolution_task_id,'done',left('resolve-rainbow-chard-mg5:'||v_resolution_task_id::text,160),null,
        'MG5','Owner assigned MG5 as the canonical transplant destination.','resolve_destination','destination_resolution',
        jsonb_build_object('destinationObjectId',v_mg5_id,'destinationLabel','MG5','sourceTaskId',v_task_id),null
      );
    end if;
  end if;
end $$;

-- Restore the clarified rollover contract immediately for Elm Farm. Saturday work
-- advances to Monday because worker_day_on_or_after_v1 honors the worker calendar.
do $$
declare
  r record;
begin
  for r in
    select fm.farm_id,fm.id membership_id
    from atlas.farm_memberships fm
    join atlas.farms f on f.id=fm.farm_id
    where f.stable_key='elm_farm' and fm.active=true and fm.role='farm_hand'
  loop
    perform atlas.roll_expired_worker_tasks_v1(r.farm_id,r.membership_id,'2026-08-24'::date);
  end loop;
end $$;

select atlas.sync_all_worker_task_readiness_escalations_v1();
