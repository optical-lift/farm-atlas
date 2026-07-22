-- One bounded, farm-agnostic release engine. It is the only path that turns
-- generated planned work into an executable task.

create or replace function atlas.release_eligible_work_v1(
  p_farm_id uuid,
  p_as_of_date date default null,
  p_limit integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  v_settings atlas.farm_task_release_settings%rowtype;
  v_today date;
  v_limit integer;
  v_active_top integer;
  v_released integer := 0;
  v_capacity_blocked integer := 0;
  v_failed integer := 0;
  o record;
  v_template atlas.tasks%rowtype;
  v_task_id uuid;
  v_policy_active integer;
  v_assignee uuid;
  v_member_active integer;
  v_parent_task_id uuid;
begin
  insert into atlas.farm_task_release_settings(farm_id)
  values(p_farm_id)
  on conflict(farm_id) do nothing;

  select * into v_settings
  from atlas.farm_task_release_settings
  where farm_id=p_farm_id;

  if not found then
    raise exception 'Farm release settings were not found.' using errcode='P0002';
  end if;

  v_today := coalesce(
    p_as_of_date,
    (now() at time zone v_settings.timezone_name)::date
  );
  v_limit := least(
    coalesce(p_limit,v_settings.maximum_release_batch_size),
    v_settings.maximum_release_batch_size
  );

  perform pg_advisory_xact_lock(
    hashtextextended('release:' || p_farm_id::text,0)
  );

  select count(*)::integer
  into v_active_top
  from atlas.tasks
  where farm_id=p_farm_id
    and status in ('open','blocked')
    and parent_task_id is null;

  -- Do not scan hundreds of occurrences or write repeated capacity events when
  -- the farm is already full. A task completion invokes this function again.
  if v_active_top>=v_settings.maximum_active_top_level_tasks then
    return jsonb_build_object(
      'farmId',p_farm_id,
      'asOfDate',v_today,
      'released',0,
      'capacityBlocked',1,
      'failed',0,
      'activeTopLevel',v_active_top,
      'farmCapacityReached',true
    );
  end if;

  for o in
    select
      occ.*,
      p.gate_type,
      p.horizon_days,
      p.maximum_active_instances,
      p.gate_config,
      (
        select count(*)::integer
        from atlas.tasks current_task
        join atlas.planned_work_occurrences current_occurrence
          on current_occurrence.id=current_task.planned_occurrence_id
        where current_occurrence.release_policy_id=p.id
          and current_task.status in ('open','blocked')
      ) as current_policy_active
    from atlas.planned_work_occurrences occ
    join atlas.work_release_policies p
      on p.id=occ.release_policy_id and p.active
    join atlas.work_definitions d
      on d.id=occ.work_definition_id and d.active
    where occ.farm_id=p_farm_id
      and occ.state in ('planned','eligible','failed')
      and (occ.not_before_date is null or occ.not_before_date<=v_today)
      and (
        occ.planned_due_date is null
        or occ.planned_due_date<=v_today+least(
          p.horizon_days,v_settings.maximum_task_horizon_days
        )
      )
      and (
        p.gate_type in ('immediate','time_window','serial_queue')
        or occ.gate_satisfied_at is not null
      )
      and (
        occ.parent_occurrence_id is null
        or exists(
          select 1
          from atlas.planned_work_occurrences parent
          join atlas.tasks parent_task
            on parent_task.id=parent.released_task_id
          where parent.id=occ.parent_occurrence_id
            and parent.state='released'
            and parent_task.status in ('open','blocked')
        )
      )
    order by
      case
        when (
          select count(*)
          from atlas.tasks current_task
          join atlas.planned_work_occurrences current_occurrence
            on current_occurrence.id=current_task.planned_occurrence_id
          where current_occurrence.release_policy_id=p.id
            and current_task.status in ('open','blocked')
        ) < p.maximum_active_instances then 0
        else 1
      end,
      occ.planned_due_date nulls first,
      occ.created_at,
      occ.id
    limit greatest(v_limit*20,200)
    for update of occ skip locked
  loop
    exit when v_released>=v_limit;
    exit when v_active_top>=v_settings.maximum_active_top_level_tasks;

    v_policy_active := o.current_policy_active;
    if v_policy_active>=o.maximum_active_instances then
      v_capacity_blocked := v_capacity_blocked+1;
      if not exists(
        select 1
        from atlas.work_gate_evaluations recent
        where recent.occurrence_id=o.id
          and recent.outcome='capacity_blocked'
          and recent.reason='Release-policy active-instance ceiling reached.'
          and recent.evaluated_at>now()-interval '6 hours'
      ) then
        insert into atlas.work_gate_evaluations(
          farm_id,occurrence_id,release_policy_id,outcome,reason,gate_snapshot
        )
        values(
          p_farm_id,o.id,o.release_policy_id,'capacity_blocked',
          'Release-policy active-instance ceiling reached.',
          jsonb_build_object(
            'active_instances',v_policy_active,
            'maximum',o.maximum_active_instances
          )
        );
      end if;
      continue;
    end if;

    begin
      update atlas.planned_work_occurrences
      set state='releasing',updated_at=now()
      where id=o.id;

      select * into v_template
      from jsonb_populate_record(null::atlas.tasks,o.task_payload);

      v_assignee := v_template.assigned_membership_id;
      if v_assignee is not null and not exists(
        select 1
        from atlas.farm_memberships fm
        where fm.id=v_assignee
          and fm.farm_id=p_farm_id
          and fm.active
      ) then
        v_assignee := null;
      end if;

      if v_assignee is not null then
        select count(*)::integer
        into v_member_active
        from atlas.tasks
        where farm_id=p_farm_id
          and assigned_membership_id=v_assignee
          and status in ('open','blocked');

        if v_member_active>=v_settings.maximum_active_tasks_per_member then
          update atlas.planned_work_occurrences
          set state='eligible',updated_at=now()
          where id=o.id;

          if not exists(
            select 1
            from atlas.work_gate_evaluations recent
            where recent.occurrence_id=o.id
              and recent.outcome='capacity_blocked'
              and recent.reason='Assigned member active-task ceiling reached.'
              and recent.evaluated_at>now()-interval '6 hours'
          ) then
            insert into atlas.work_gate_evaluations(
              farm_id,occurrence_id,release_policy_id,outcome,reason,gate_snapshot
            )
            values(
              p_farm_id,o.id,o.release_policy_id,'capacity_blocked',
              'Assigned member active-task ceiling reached.',
              jsonb_build_object(
                'assigned_membership_id',v_assignee,
                'active_tasks',v_member_active,
                'maximum',v_settings.maximum_active_tasks_per_member
              )
            );
          end if;

          v_capacity_blocked := v_capacity_blocked+1;
          continue;
        end if;
      end if;

      v_parent_task_id := coalesce(
        (
          select parent.released_task_id
          from atlas.planned_work_occurrences parent
          where parent.id=o.parent_occurrence_id
            and parent.state='released'
        ),
        case
          when exists(
            select 1 from atlas.tasks existing_parent
            where existing_parent.id=v_template.parent_task_id
          ) then v_template.parent_task_id
          else null
        end
      );

      insert into atlas.tasks(
        farm_id,zone_id,title,task_type,status,priority,due_date,
        unlock_text,blocker_text,generated_from,generated_from_id,note,metadata,
        action_key,work_class,parent_task_id,task_series_key,engine_instance_key,
        visibility_scope,assigned_membership_id,planned_occurrence_id,
        release_policy_id,released_at,release_reason
      )
      values(
        p_farm_id,
        v_template.zone_id,
        o.title,
        coalesce(nullif(v_template.task_type,''),'general'),
        'open',
        coalesce(nullif(v_template.priority,''),'normal'),
        o.planned_due_date,
        v_template.unlock_text,
        null,
        v_template.generated_from,
        v_template.generated_from_id,
        v_template.note,
        coalesce(v_template.metadata,'{}'::jsonb) ||
          jsonb_build_object('released_by','release_eligible_work_v1'),
        v_template.action_key,
        v_template.work_class,
        v_parent_task_id,
        v_template.task_series_key,
        v_template.engine_instance_key,
        case
          when v_assignee is null
           and v_template.visibility_scope='assigned_worker' then 'management'
          else coalesce(v_template.visibility_scope,'farm_shared')
        end,
        v_assignee,
        o.id,
        o.release_policy_id,
        now(),
        'central_release_engine'
      )
      returning id into v_task_id;

      perform atlas.restore_task_relation_payload_v1(v_task_id,o.relation_payload);
      perform atlas.attach_released_task_to_source_v1(o.id,v_task_id);

      insert into atlas.work_gate_evaluations(
        farm_id,occurrence_id,release_policy_id,outcome,reason,gate_snapshot
      )
      values(
        p_farm_id,o.id,o.release_policy_id,'released',
        'Release gate satisfied.',
        jsonb_build_object('task_id',v_task_id,'as_of_date',v_today)
      );

      v_released := v_released+1;
      if v_parent_task_id is null then
        v_active_top := v_active_top+1;
      end if;
    exception when others then
      update atlas.planned_work_occurrences
      set
        state='failed',
        metadata=metadata||jsonb_build_object(
          'last_release_error',sqlerrm,
          'last_release_error_at',now()
        ),
        updated_at=now()
      where id=o.id;

      insert into atlas.work_gate_evaluations(
        farm_id,occurrence_id,release_policy_id,outcome,reason,gate_snapshot
      )
      values(
        p_farm_id,o.id,o.release_policy_id,'failed',sqlerrm,
        jsonb_build_object('sqlstate',sqlstate)
      );
      v_failed := v_failed+1;
    end;
  end loop;

  return jsonb_build_object(
    'farmId',p_farm_id,
    'asOfDate',v_today,
    'released',v_released,
    'capacityBlocked',v_capacity_blocked,
    'failed',v_failed,
    'activeTopLevel',v_active_top,
    'farmCapacityReached',
      v_active_top>=v_settings.maximum_active_top_level_tasks
  );
end;
$fn$;

create or replace function atlas.release_all_farms_v1(
  p_as_of_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  f record;
  v_results jsonb := '[]'::jsonb;
begin
  for f in
    select farm_id
    from atlas.farm_task_release_settings
    where active
    order by farm_id
  loop
    v_results := v_results || jsonb_build_array(
      atlas.release_eligible_work_v1(f.farm_id,p_as_of_date,null)
    );
  end loop;

  return jsonb_build_object('ranAt',now(),'farms',v_results);
end;
$fn$;

create or replace function atlas.signal_work_occurrence_v1(
  p_occurrence_id uuid,
  p_signal_key text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  o atlas.planned_work_occurrences%rowtype;
  v_release jsonb;
begin
  select * into o
  from atlas.planned_work_occurrences
  where id=p_occurrence_id
  for update;

  if o.id is null then
    raise exception 'Planned occurrence was not found.' using errcode='P0002';
  end if;

  update atlas.planned_work_occurrences
  set
    gate_satisfied_at=now(),
    state=case
      when state in ('released','completed') then state
      else 'eligible'
    end,
    metadata=metadata||jsonb_build_object(
      'last_signal_key',p_signal_key,
      'last_signal_payload',coalesce(p_payload,'{}'::jsonb),
      'last_signal_at',now()
    ),
    updated_at=now()
  where id=o.id;

  v_release := atlas.release_eligible_work_v1(o.farm_id,null,1);
  return jsonb_build_object(
    'occurrenceId',o.id,
    'release',v_release,
    'taskId',(
      select released_task_id
      from atlas.planned_work_occurrences
      where id=o.id
    )
  );
end;
$fn$;

create or replace function atlas.release_after_task_terminal_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
begin
  if old.status in ('open','blocked')
     and new.status in ('done','archived','skipped')
  then
    if new.planned_occurrence_id is not null then
      update atlas.planned_work_occurrences child
      set
        state=case when new.status='done' then 'completed' else 'cancelled' end,
        updated_at=now(),
        metadata=child.metadata||jsonb_build_object(
          'closed_with_parent_task_id',new.id,
          'closed_with_parent_status',new.status,
          'closed_at',now()
        )
      where child.parent_occurrence_id=new.planned_occurrence_id
        and child.state in ('planned','eligible','failed');

      update atlas.planned_work_occurrences
      set
        state=case when new.status='done' then 'completed' else 'cancelled' end,
        updated_at=now(),
        metadata=metadata||jsonb_build_object(
          'terminal_task_status',new.status,
          'terminal_task_id',new.id,
          'terminal_at',now()
        )
      where id=new.planned_occurrence_id;
    end if;

    perform atlas.release_eligible_work_v1(new.farm_id,null,10);
  end if;
  return new;
end;
$fn$;

create or replace function atlas.validate_workflow_handoff_mode_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  v_source atlas.tasks%rowtype;
  v_payload jsonb := '{}'::jsonb;
  v_action text;
  v_task_type text;
  v_visibility text;
  v_metadata jsonb := '{}'::jsonb;
  v_is_owner boolean := false;
  v_is_readiness boolean := false;
  v_is_resource_confirmation boolean := false;
begin
  if new.source_kind='task' then
    if new.source_id is not null then
      select * into v_source
      from atlas.tasks
      where id=new.source_id and farm_id=new.farm_id;
    end if;

    if v_source.id is not null then
      v_action := lower(coalesce(
        nullif(v_source.action_key,''),
        nullif(v_source.metadata->>'work_route',''),
        v_source.task_type,''
      ));
      v_task_type := lower(coalesce(v_source.task_type,''));
      v_visibility := v_source.visibility_scope;
      v_metadata := coalesce(v_source.metadata,'{}'::jsonb);
    elsif new.source_occurrence_id is not null then
      select o.task_payload into v_payload
      from atlas.planned_work_occurrences o
      where o.id=new.source_occurrence_id
        and o.farm_id=new.farm_id;

      if v_payload is null then
        raise exception
          'Workflow handoff source occurrence was not found in this farm.'
          using errcode='23503';
      end if;

      v_metadata := coalesce(v_payload->'metadata','{}'::jsonb);
      v_action := lower(coalesce(
        nullif(v_payload->>'action_key',''),
        nullif(v_metadata->>'work_route',''),
        v_payload->>'task_type',''
      ));
      v_task_type := lower(coalesce(v_payload->>'task_type',''));
      v_visibility := coalesce(
        v_payload->>'visibility_scope','system_internal'
      );
    else
      raise exception
        'Workflow handoff task source requires a released task or planned occurrence.'
        using errcode='23503';
    end if;

    v_is_owner :=
      v_visibility='owner'
      or lower(coalesce(v_metadata->>'owner_task','false')) in ('true','yes','1')
      or v_action in ('approve','approval','decide','decision','owner_decision');
    v_is_readiness :=
      v_action in (
        'check','verify','readiness_check','transplant_readiness',
        'propagation_readiness'
      )
      or v_task_type like '%readiness%'
      or lower(coalesce(v_metadata->>'relationship_kind',''))='readiness_gate';
    v_is_resource_confirmation :=
      v_action in (
        'confirm_resource','receive','inventory_check','resource_confirmation'
      )
      or v_task_type in ('resource_confirmation','inventory_confirmation')
      or lower(coalesce(v_metadata->>'resource_confirmation','false'))
        in ('true','yes','1');
  end if;

  if new.handoff_mode='date_window'
     and (
       new.effect<>'schedule_task'
       or (new.target_date is null and new.delay_days=0)
     )
  then
    raise exception
      'Date-window handoffs must schedule a task using a target date or delay.'
      using errcode='23514';
  end if;

  if new.handoff_mode='readiness_confirmed'
     and (new.source_kind<>'task' or not v_is_readiness)
  then
    raise exception
      'Readiness-confirmed handoffs must originate from an explicit readiness task or occurrence.'
      using errcode='23514';
  end if;

  if new.handoff_mode='resource_confirmed'
     and (new.source_kind<>'task' or not v_is_resource_confirmation)
  then
    raise exception
      'Resource-confirmed handoffs must originate from an explicit resource confirmation task or occurrence.'
      using errcode='23514';
  end if;

  if new.handoff_mode='owner_decision'
     and (new.source_kind<>'task' or not v_is_owner)
  then
    raise exception
      'Owner-decision handoffs must originate from an Owner decision task or occurrence.'
      using errcode='23514';
  end if;

  if new.handoff_mode='result_dependent'
     and new.source_filter='{}'::jsonb
  then
    raise exception
      'Result-dependent handoffs require a non-empty source_filter.'
      using errcode='23514';
  end if;

  if new.handoff_mode='recurring_condition'
     and new.source_kind='task'
     and new.source_filter='{}'::jsonb
  then
    raise exception
      'Recurring-condition handoffs require a condition-bearing source or source_filter.'
      using errcode='23514';
  end if;

  return new;
end;
$fn$;

create or replace function atlas.apply_workflow_event_v1(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  v_event atlas.workflow_events%rowtype;
  v_handoff atlas.workflow_handoffs%rowtype;
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_due_date date;
  v_applied integer := 0;
  v_skipped integer := 0;
begin
  select * into v_event
  from atlas.workflow_events
  where id=p_event_id;

  if v_event.id is null then
    raise exception 'Workflow event was not found.' using errcode='P0002';
  end if;

  for v_handoff in
    select h.*
    from atlas.workflow_handoffs h
    where h.farm_id=v_event.farm_id
      and h.active
      and h.satisfied_at is null
      and h.source_kind=v_event.source_kind
      and h.source_event=v_event.source_event
      and (h.source_id is null or h.source_id=v_event.source_id)
      and (h.source_key is null or h.source_key=v_event.source_key)
      and (h.source_filter='{}'::jsonb or v_event.payload@>h.source_filter)
    order by h.created_at,h.id
    for update skip locked
  loop
    v_due_date := coalesce(
      v_handoff.target_date,
      v_event.event_date+v_handoff.delay_days,
      v_event.event_date
    );

    if v_handoff.target_occurrence_id is not null then
      select * into v_occurrence
      from atlas.planned_work_occurrences
      where id=v_handoff.target_occurrence_id
      for update;

      if v_occurrence.id is null
         or v_occurrence.state in ('completed','cancelled')
      then
        v_skipped := v_skipped+1;
        continue;
      end if;

      update atlas.planned_work_occurrences
      set
        planned_due_date=coalesce(planned_due_date,v_due_date),
        gate_satisfied_at=now(),
        state='eligible',
        metadata=metadata||jsonb_build_object(
          'workflow_event_id',v_event.id,
          'workflow_handoff_id',v_handoff.id,
          'workflow_gate_state','ready'
        ),
        updated_at=now()
      where id=v_occurrence.id;

      perform atlas.release_eligible_work_v1(
        v_event.farm_id,v_event.event_date,10
      );

      update atlas.workflow_handoffs
      set
        target_task_id=(
          select released_task_id
          from atlas.planned_work_occurrences
          where id=v_occurrence.id
        ),
        satisfied_at=now(),
        satisfied_by_event_id=v_event.id,
        metadata=metadata||jsonb_build_object(
          'satisfaction_state','applied_to_occurrence',
          'resolved_due_date',v_due_date
        ),
        updated_at=now()
      where id=v_handoff.id;
      v_applied := v_applied+1;

    elsif v_handoff.target_task_id is not null then
      update atlas.workflow_handoffs
      set
        satisfied_at=now(),
        satisfied_by_event_id=v_event.id,
        metadata=metadata||jsonb_build_object(
          'satisfaction_state','legacy_task_target',
          'resolved_due_date',v_due_date
        ),
        updated_at=now()
      where id=v_handoff.id;

      perform atlas.record_task_transition_v1_internal(
        v_handoff.target_task_id,
        'rescheduled',
        left('workflow:'||v_handoff.id::text||':'||v_event.id::text,160),
        v_due_date,
        coalesce(
          nullif(v_handoff.metadata->>'transition_note',''),
          'Opened by Atlas workflow handoff.'
        ),
        coalesce(
          nullif(v_handoff.metadata->>'transition_reason',''),
          'Required prior farm work was recorded.'
        ),
        'workflow',
        v_handoff.stable_key,
        jsonb_build_object(
          'completion_source','workflow_handoff',
          'workflow_event_id',v_event.id,
          'workflow_handoff_id',v_handoff.id
        ),
        null
      );
      v_applied := v_applied+1;
    else
      v_skipped := v_skipped+1;
    end if;
  end loop;

  return jsonb_build_object(
    'eventId',v_event.id,
    'applied',v_applied,
    'skipped',v_skipped
  );
end;
$fn$;

-- Compatibility API for the existing completion-gated serial queue. Queued
-- items point at occurrences, and this function signals the occurrence rather
-- than reopening a pre-created task row.
create or replace function atlas.sync_task_release_queue_summary_v1(
  p_farm_id uuid,
  p_queue_key text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  v_active_count integer;
  v_queued_count integer;
  v_completed_count integer;
  v_next_label text;
begin
  select
    count(*) filter(where qi.state='active'),
    count(*) filter(where qi.state='queued'),
    count(*) filter(where qi.state='completed'),
    (
      select coalesce(
        nullif(t.metadata->>'display_subject',''),
        nullif(t.metadata->>'collection_label',''),
        t.title,
        o.title
      )
      from atlas.task_release_queue_items next_qi
      left join atlas.tasks t on t.id=next_qi.task_id
      left join atlas.planned_work_occurrences o
        on o.id=next_qi.planned_occurrence_id
      where next_qi.farm_id=p_farm_id
        and next_qi.queue_key=p_queue_key
        and next_qi.state='queued'
      order by next_qi.position
      limit 1
    )
  into v_active_count,v_queued_count,v_completed_count,v_next_label
  from atlas.task_release_queue_items qi
  where qi.farm_id=p_farm_id and qi.queue_key=p_queue_key;

  update atlas.tasks t
  set
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'release_queue_key',qi.queue_key,
      'release_queue_state',qi.state,
      'release_queue_position',qi.position,
      'release_queue_initial_batch',qi.initial_batch,
      'release_queue_policy','completion_gated_serial',
      'release_queue_active_count',coalesce(v_active_count,0),
      'release_queue_queued_count',coalesce(v_queued_count,0),
      'release_queue_completed_count',coalesce(v_completed_count,0),
      'release_queue_next_label',coalesce(v_next_label,''),
      'release_queue_summary_updated_at',now()
    ),
    updated_at=now()
  from atlas.task_release_queue_items qi
  where qi.task_id=t.id
    and qi.farm_id=p_farm_id
    and qi.queue_key=p_queue_key
    and qi.state='active';
end;
$fn$;

create or replace function atlas.release_next_task_in_queue_v1(
  p_farm_id uuid,
  p_queue_key text,
  p_completed_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $fn$
declare
  v_next_item atlas.task_release_queue_items%rowtype;
  v_due_date date;
  v_completed_date date := coalesce(
    p_completed_date,
    (now() at time zone 'America/Chicago')::date
  );
  v_occurrence_id uuid;
  v_task_id uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_farm_id::text||':'||p_queue_key,0)
  );

  if exists(
    select 1
    from atlas.task_release_queue_items qi
    left join atlas.tasks t on t.id=qi.task_id
    left join atlas.planned_work_occurrences o
      on o.id=qi.planned_occurrence_id
    where qi.farm_id=p_farm_id
      and qi.queue_key=p_queue_key
      and qi.initial_batch
      and qi.state<>'completed'
      and coalesce(t.status,'open')<>'done'
      and coalesce(o.state,'released')<>'completed'
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

  v_occurrence_id := coalesce(
    v_next_item.planned_occurrence_id,
    (
      select t.planned_occurrence_id
      from atlas.tasks t
      where t.id=v_next_item.task_id
    )
  );

  if v_occurrence_id is null then
    raise exception
      'Queued item % has no planned occurrence and cannot be released safely.',
      v_next_item.id
      using errcode='23514';
  end if;

  v_due_date := v_completed_date+1;
  if extract(dow from v_due_date)=0 then
    v_due_date := v_due_date+1;
  end if;

  update atlas.planned_work_occurrences
  set
    planned_due_date=v_due_date,
    not_before_date=least(coalesce(not_before_date,v_due_date),v_due_date),
    gate_satisfied_at=now(),
    state=case
      when state in ('released','completed') then state
      else 'eligible'
    end,
    metadata=metadata||jsonb_build_object(
      'release_queue_key',p_queue_key,
      'release_queue_position',v_next_item.position,
      'released_after_previous_completion',true,
      'released_for_date',v_due_date,
      'queue_gate_satisfied_at',now()
    ),
    updated_at=now()
  where id=v_occurrence_id;

  perform atlas.release_eligible_work_v1(p_farm_id,v_completed_date,1);

  select released_task_id into v_task_id
  from atlas.planned_work_occurrences
  where id=v_occurrence_id;

  if v_task_id is not null and exists(
    select 1 from atlas.tasks
    where id=v_task_id and status in ('open','blocked')
  ) then
    update atlas.task_release_queue_items
    set
      task_id=v_task_id,
      planned_occurrence_id=v_occurrence_id,
      state='active',
      activated_at=now(),
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'released_after_completion',true,
        'released_for_date',v_due_date,
        'released_at',now(),
        'release_architecture','planned_occurrence_gate'
      )
    where id=v_next_item.id;
  else
    update atlas.task_release_queue_items
    set
      planned_occurrence_id=v_occurrence_id,
      task_id=null,
      state='queued',
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'release_attempted_at',now(),
        'release_waiting_on_capacity',true,
        'release_architecture','planned_occurrence_gate'
      )
    where id=v_next_item.id;
    v_task_id := null;
  end if;

  perform atlas.sync_task_release_queue_summary_v1(p_farm_id,p_queue_key);
  return v_task_id;
end;
$fn$;

revoke all on function atlas.release_eligible_work_v1(uuid,date,integer)
  from public,anon,authenticated;
revoke all on function atlas.release_all_farms_v1(date)
  from public,anon,authenticated;
revoke all on function atlas.signal_work_occurrence_v1(uuid,text,jsonb)
  from public,anon,authenticated;
