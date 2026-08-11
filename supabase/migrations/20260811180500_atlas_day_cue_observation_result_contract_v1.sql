-- Day observation gate completion v1
-- Makes cue answers capable of changing canonical farm state through a narrow,
-- typed result contract without turning cues into tasks or arbitrary mutation payloads.

create or replace function atlas.apply_worker_day_cue_result_contract_v1(
  p_cue_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_cue atlas.worker_day_cues%rowtype;
  v_contract jsonb;
  v_kind text;
  v_task atlas.tasks%rowtype;
  v_task_id uuid;
  v_readiness text;
  v_condition text;
  v_count integer;
  v_service_day date;
  v_next_day date;
  v_next_cue_id uuid;
  v_next_task_id uuid;
  v_transition_result jsonb := '{}'::jsonb;
  v_observation jsonb;
  v_move_title text;
  v_move_action text;
  v_subject text;
begin
  select * into v_cue
  from atlas.worker_day_cues cue
  where cue.id=p_cue_id
  for update;

  if v_cue.id is null then
    raise exception 'Cue was not found.' using errcode='P0002';
  end if;

  v_contract:=coalesce(v_cue.result_contract,'{}'::jsonb);
  if v_contract='{}'::jsonb then
    return jsonb_build_object('applied',false,'kind',null);
  end if;

  if jsonb_typeof(coalesce(p_response,'{}'::jsonb))<>'object' then
    raise exception 'Cue response data must be an object.' using errcode='22023';
  end if;

  v_kind:=nullif(v_contract->>'kind','');
  if v_kind<>'transplant_readiness_gate_v1' then
    raise exception 'Unsupported Day cue result contract.' using errcode='22023';
  end if;

  begin
    v_task_id:=nullif(v_contract->>'taskId','')::uuid;
  exception when invalid_text_representation then
    raise exception 'Cue result contract task id is invalid.' using errcode='22023';
  end;

  select * into v_task
  from atlas.tasks task
  where task.id=v_task_id
    and task.farm_id=v_cue.farm_id
    and task.assigned_membership_id=v_cue.membership_id
  for update;

  if v_task.id is null then
    raise exception 'Cue result task is outside the worker Day.' using errcode='55000';
  end if;
  if v_task.task_type<>'transplant_readiness'
     and coalesce(v_task.metadata->>'task_style','')<>'transplant_readiness' then
    raise exception 'Cue result task is not a transplant-readiness source.' using errcode='22023';
  end if;

  -- Never manufacture an overdue downstream move when a stale observation is
  -- answered later than the day on which Atlas first wanted the information.
  v_service_day:=greatest(v_cue.service_date,current_date);
  v_readiness:=lower(coalesce(nullif(btrim(p_response->>'readiness'),''),''));
  v_condition:=lower(coalesce(nullif(btrim(p_response->>'condition'),''),''));
  if v_readiness not in ('ready','not_ready','already_potted','problem') then
    raise exception 'Choose the current seedling state.' using errcode='22023';
  end if;

  if nullif(p_response->>'surviving_count','') is not null then
    begin
      v_count:=(p_response->>'surviving_count')::integer;
    exception when invalid_text_representation then
      raise exception 'Surviving seedling count must be a whole number.' using errcode='22023';
    end;
    if v_count<0 then
      raise exception 'Surviving seedling count cannot be negative.' using errcode='22023';
    end if;
  end if;

  if v_readiness='ready' then
    if v_condition not in ('all_great','struggling','record_number') then
      raise exception 'Record how the seedlings made it.' using errcode='22023';
    end if;
    if v_condition='record_number' and (v_count is null or v_count<1) then
      raise exception 'Enter the surviving seedling count.' using errcode='22023';
    end if;
  end if;

  v_observation:=jsonb_strip_nulls(jsonb_build_object(
    'readiness',v_readiness,
    'condition',nullif(v_condition,''),
    'surviving_count',v_count,
    'observed_date',v_service_day,
    'recorded_at',now(),
    'source','worker_day_cue',
    'cue_id',v_cue.id,
    'actor_user_id',auth.uid(),
    'actor_membership_id',v_cue.membership_id
  ));

  update atlas.tasks task
  set metadata=coalesce(task.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'latest_transplant_readiness_observation',v_observation,
        'transplant_readiness_status',v_readiness,
        'transplant_readiness_condition',nullif(v_condition,''),
        'transplant_ready_seedlings',v_count,
        'observation_delivery_mode','day_cue'
      ),
      updated_at=now()
  where task.id=v_task.id;

  if v_readiness='not_ready' then
    v_next_day:=atlas.next_worker_day_v1(v_cue.farm_id,v_cue.membership_id,v_service_day);
    insert into atlas.worker_day_cues(
      organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,anchor_task_id,
      scheduled_at,title,body,payload,result_contract,status,recovery_policy,
      available_from,expires_at,created_by_user_id
    )
    select
      v_cue.organization_id,v_cue.farm_id,v_cue.membership_id,v_next_day,
      v_cue.cue_kind,'first_open',null,null,
      v_cue.title,v_cue.body,v_cue.payload,v_cue.result_contract,
      'available','refresh',null,v_cue.expires_at,v_cue.created_by_user_id
    where not exists (
      select 1 from atlas.worker_day_cues existing
      where existing.farm_id=v_cue.farm_id
        and existing.membership_id=v_cue.membership_id
        and existing.service_date=v_next_day
        and existing.status not in ('resolved','dismissed')
        and existing.result_contract->>'kind'='transplant_readiness_gate_v1'
        and existing.result_contract->>'taskId'=v_task.id::text
    )
    returning id into v_next_cue_id;

    return jsonb_build_object(
      'applied',true,
      'kind',v_kind,
      'farmState','not_ready',
      'nextObservationDay',v_next_day,
      'nextCueId',v_next_cue_id
    );
  end if;

  if v_readiness='problem' then
    -- The worker observation itself is finished, but the farm-state source is
    -- now a management blocker rather than a missed worker obligation.
    update atlas.tasks
    set status='blocked',
        visibility_scope='management',
        blocker_text='Fall kale problem reported through the readiness observation.',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('readiness_problem_reported',true),
        updated_at=now()
    where id=v_task.id;

    return jsonb_build_object('applied',true,'kind',v_kind,'farmState','problem_reported');
  end if;

  v_transition_result:=atlas.record_task_transition_v1_internal(
    p_task_id=>v_task.id,
    p_transition=>'done',
    p_idempotency_key=>'day-cue:'||v_cue.id::text||':'||v_readiness,
    p_target_date=>null,
    p_note=>null,
    p_reason=>null,
    p_lane_key=>coalesce(v_task.action_key,'transplant_readiness'),
    p_work_key=>'transplant_readiness',
    p_payload=>jsonb_build_object(
      'completion_source','day_cue_observation',
      'day_cue_id',v_cue.id,
      'readiness',v_readiness,
      'condition',nullif(v_condition,''),
      'surviving_count',v_count,
      'observed_date',v_service_day
    ),
    p_existing_field_log_id=>null
  );

  if v_readiness='already_potted' then
    update atlas.tasks
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('pot_up_reconciled_as_already_done',true),
        updated_at=now()
    where id=v_task.id;
    return jsonb_build_object(
      'applied',true,'kind',v_kind,'farmState','already_potted',
      'transition',v_transition_result
    );
  end if;

  v_move_action:=coalesce(nullif(v_contract->>'readyMoveAction',''),'pot_up');
  if v_move_action<>'pot_up' then
    raise exception 'Unsupported readiness release action.' using errcode='22023';
  end if;
  v_subject:=coalesce(
    nullif(v_contract->>'subject',''),
    nullif(v_task.metadata->>'variety',''),
    nullif(v_task.metadata->>'crop',''),
    'seedlings'
  );
  v_move_title:=coalesce(nullif(v_contract->>'readyMoveTitle',''),'Pot up '||v_subject);

  select id into v_next_task_id
  from atlas.tasks next_task
  where next_task.farm_id=v_task.farm_id
    and next_task.status<>'archived'
    and next_task.metadata->>'source_readiness_task_id'=v_task.id::text
    and next_task.action_key='pot_up'
  order by next_task.created_at desc
  limit 1;

  if v_next_task_id is null then
    insert into atlas.tasks(
      farm_id,title,task_type,status,priority,due_date,note,metadata,action_key,work_class,
      visibility_scope,assigned_membership_id,organization_id,task_scope,assigned_user_id,
      created_by_user_id,origin_kind,work_lane,commitment_kind,effort_units,
      operation_class,operation_class_source,released_at,release_reason
    ) values (
      v_task.farm_id,v_move_title,'pot_up','open',v_task.priority,v_service_day,null,
      jsonb_strip_nulls(jsonb_build_object(
        'generated_from_day_cue',true,
        'source_day_cue_id',v_cue.id,
        'source_readiness_task_id',v_task.id,
        'source_sowing_task_id',v_task.metadata->>'source_sowing_task_id',
        'crop_profile_id',v_task.metadata->>'crop_profile_id',
        'crop_profile_stable_key',v_task.metadata->>'crop_profile_stable_key',
        'display_action','Pot up',
        'display_subject',v_subject,
        'display_detail',case when v_count is not null then v_count::text||' surviving seedlings' else 'Seedlings are ready' end,
        'collection_zone',coalesce(v_task.metadata->>'collection_zone','Grow Room'),
        'display_location',coalesce(v_task.metadata->>'collection_zone','Grow Room'),
        'executor_role','farm_hand',
        'executor_membership_id',v_cue.membership_id,
        'work_rhythm','Pot Up',
        'execution_do',v_move_title,
        'execution_done_when','The ready fall kale seedlings are potted up.',
        'readiness_observation',v_observation,
        'execution_date',v_service_day
      )),
      'pot_up','standard','assigned_worker',v_cue.membership_id,v_task.organization_id,
      'farm_operation',v_task.assigned_user_id,null,'generated','process_continuation','dependency',1,
      'establish_aboveground','day_cue_readiness_v1',now(),'observation_gate_ready'
    ) returning id into v_next_task_id;
  end if;

  return jsonb_build_object(
    'applied',true,
    'kind',v_kind,
    'farmState','ready',
    'nextTaskId',v_next_task_id,
    'transition',v_transition_result
  );
end;
$$;

revoke all on function atlas.apply_worker_day_cue_result_contract_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function atlas.apply_worker_day_cue_result_contract_v1(uuid,jsonb) to service_role;

create or replace function atlas.worker_resolve_day_cue_api_v1(
  p_cue_id uuid,
  p_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_cue atlas.worker_day_cues%rowtype;
  v_contract_result jsonb:='{}'::jsonb;
  v_is_worker boolean:=false;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;

  select cue.* into v_cue
  from atlas.worker_day_cues cue
  join atlas.farm_memberships fm on fm.id=cue.membership_id
  where cue.id=p_cue_id
    and fm.active=true
    and (
      fm.user_id=auth.uid()
      or exists (
        select 1 from atlas.farm_memberships owner_membership
        where owner_membership.farm_id=cue.farm_id
          and owner_membership.active=true
          and owner_membership.role='owner'
          and owner_membership.user_id=auth.uid()
      )
    )
  for update of cue;
  if v_cue.id is null then
    raise exception 'Cue access required.' using errcode='42501';
  end if;

  if v_cue.status='resolved' then
    return jsonb_build_object(
      'contractVersion','worker_day_cue_resolution_v1',
      'cueId',v_cue.id,
      'status',v_cue.status,
      'resolvedAt',v_cue.resolved_at,
      'response',v_cue.response,
      'deduplicated',true
    );
  end if;

  select exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=v_cue.membership_id and fm.active=true and fm.user_id=auth.uid()
  ) into v_is_worker;

  if coalesce(v_cue.result_contract,'{}'::jsonb)<>'{}'::jsonb then
    if not v_is_worker then
      raise exception 'Only the assigned worker can resolve a farm-state cue.' using errcode='42501';
    end if;
    v_contract_result:=atlas.apply_worker_day_cue_result_contract_v1(v_cue.id,coalesce(p_response,'{}'::jsonb));
  end if;

  update atlas.worker_day_cues cue
  set response=case
        when jsonb_typeof(coalesce(p_response,'{}'::jsonb))='object' then coalesce(p_response,'{}'::jsonb)
        else '{}'::jsonb
      end,
      status='resolved',
      resolved_at=now(),
      updated_at=now()
  where cue.id=p_cue_id
  returning * into v_cue;

  return jsonb_build_object(
    'contractVersion','worker_day_cue_resolution_v1',
    'cueId',v_cue.id,
    'status',v_cue.status,
    'resolvedAt',v_cue.resolved_at,
    'response',v_cue.response,
    'resultContract',v_contract_result
  );
end;
$$;

grant execute on function atlas.worker_resolve_day_cue_api_v1(uuid,jsonb) to authenticated;

-- Recovery is presentation-time freshness. A cue that was not answered does not
-- become evidence that the underlying farm event did or did not occur.
create or replace function atlas.worker_day_choreography_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_allowed boolean:=false;
  v_placements jsonb:='[]'::jsonb;
  v_placement_overrides jsonb:='[]'::jsonb;
  v_cues jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A worker day is required.' using errcode='22023';
  end if;
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true
  ) then
    raise exception 'Active worker membership required.' using errcode='42501';
  end if;

  select exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.user_id=auth.uid()
  ) or exists(
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='owner' and fm.user_id=auth.uid()
  ) into v_allowed;
  if not v_allowed then
    raise exception 'Worker day access required.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'placementId',p.id,
    'taskId',p.task_id,
    'serviceDate',p.service_date,
    'dayWindow',p.day_window,
    'sortOrder',p.sort_order,
    'placementSource',p.placement_source,
    'placementReason',p.placement_reason,
    'state',p.state
  ) order by case p.day_window when 'morning' then 0 when 'afternoon' then 1 else 2 end,p.sort_order,p.task_id),'[]'::jsonb)
  into v_placements
  from atlas.worker_day_task_placements p
  where p.farm_id=p_farm_id
    and p.membership_id=p_membership_id
    and p.service_date=p_day
    and p.state='placed';

  select coalesce(jsonb_agg(jsonb_build_object(
    'placementId',p.id,
    'taskId',p.task_id,
    'serviceDate',p.service_date,
    'dayWindow',p.day_window,
    'sortOrder',p.sort_order,
    'placementSource',p.placement_source,
    'placementReason',p.placement_reason,
    'state',p.state
  ) order by p.updated_at desc,p.task_id),'[]'::jsonb)
  into v_placement_overrides
  from atlas.worker_day_task_placements p
  where p.farm_id=p_farm_id
    and p.membership_id=p_membership_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cueId',c.id,
    'serviceDate',c.service_date,
    'cueKind',c.cue_kind,
    'anchorKind',c.anchor_kind,
    'anchorTaskId',c.anchor_task_id,
    'scheduledAt',c.scheduled_at,
    'title',case
      when c.service_date<p_day then coalesce(nullif(c.payload->>'recoveryTitle',''),c.title)
      else c.title
    end,
    'body',case
      when c.service_date<p_day then coalesce(nullif(c.payload->>'recoveryPrompt',''),c.body)
      else c.body
    end,
    'payload',c.payload,
    'status',case
      when c.service_date<p_day and c.status not in ('resolved','dismissed') then 'stale'
      else c.status
    end,
    'recoveryPolicy',c.recovery_policy,
    'availableFrom',c.available_from,
    'expiresAt',c.expires_at,
    'response',c.response,
    'resolvedAt',c.resolved_at
  ) order by
    case c.anchor_kind when 'first_open' then 0 when 'before_task' then 1 when 'after_task' then 2 else 3 end,
    c.service_date,
    coalesce(c.scheduled_at,c.available_from,c.created_at),c.id),'[]'::jsonb)
  into v_cues
  from atlas.worker_day_cues c
  where c.farm_id=p_farm_id
    and c.membership_id=p_membership_id
    and c.status<>'dismissed'
    and (
      c.service_date=p_day
      or (
        c.service_date<p_day
        and c.status<>'resolved'
        and c.recovery_policy in ('refresh','persist','block')
        and (c.available_from is null or c.available_from<=now())
      )
    );

  return jsonb_build_object(
    'contractVersion','worker_day_choreography_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_day,
    'placements',v_placements,
    'placementOverrides',v_placement_overrides,
    'cues',v_cues
  );
end;
$$;

grant execute on function atlas.worker_day_choreography_api_v1(uuid,uuid,date) to authenticated;

-- First acceptance specimen: the Fall kale readiness check stops being worker
-- work and becomes a first-open observation gate. The source task stays internal
-- so its lifecycle/result history can still drive canonical transition machinery.
do $$
declare
  v_task atlas.tasks%rowtype;
  v_service_date date;
begin
  select * into v_task
  from atlas.tasks task
  where task.status='open'
    and task.task_type='transplant_readiness'
    and task.metadata->>'crop_profile_stable_key'='fall_kale_seedling'
    and coalesce(task.metadata->>'variety','')='Fall kale mix'
  order by task.created_at desc
  limit 1;

  if v_task.id is null then
    return;
  end if;

  v_service_date:=greatest(
    current_date,
    coalesce(nullif(v_task.metadata->>'window_start','')::date,current_date)
  );

  update atlas.tasks
  set visibility_scope='system_internal',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'observation_delivery_mode','day_cue',
        'observation_gate_kind','transplant_readiness_gate_v1',
        'worker_feed_task',false,
        'observation_gate_installed_at',now()
      ),
      updated_at=now()
  where id=v_task.id;

  insert into atlas.worker_day_cues(
    organization_id,farm_id,membership_id,service_date,cue_kind,anchor_kind,anchor_task_id,
    scheduled_at,title,body,payload,result_contract,status,recovery_policy,
    available_from,expires_at,created_by_user_id
  )
  select
    v_task.organization_id,
    v_task.farm_id,
    v_task.assigned_membership_id,
    v_service_date,
    'observation',
    'first_open',
    null,
    null,
    'Fall kale',
    'Is the fall kale big enough to pot up?',
    jsonb_build_object(
      'stableKey','fall_kale_transplant_readiness_observation_v1',
      'questions',jsonb_build_array(
        jsonb_build_object(
          'key','readiness',
          'prompt','Is the fall kale big enough to pot up?',
          'choices',jsonb_build_array(
            jsonb_build_object('value','ready','label','Yes, it’s ready'),
            jsonb_build_object('value','not_ready','label','Not yet'),
            jsonb_build_object('value','already_potted','label','Already potted'),
            jsonb_build_object('value','problem','label','Something went wrong')
          )
        ),
        jsonb_build_object(
          'key','condition',
          'prompt','How did the seedlings make it?',
          'when',jsonb_build_object('key','readiness','equals','ready'),
          'choices',jsonb_build_array(
            jsonb_build_object('value','all_great','label','All of them — they look great'),
            jsonb_build_object('value','struggling','label','Struggling but still there'),
            jsonb_build_object('value','record_number','label','Record number')
          )
        ),
        jsonb_build_object(
          'key','surviving_count',
          'prompt','How many seedlings are there?',
          'when',jsonb_build_object('key','condition','equals','record_number'),
          'input','number',
          'placeholder','Surviving seedlings'
        )
      ),
      'recoveryTitle','Fall kale',
      'recoveryPrompt','What do the kale seedlings look like now?'
    ),
    jsonb_build_object(
      'kind','transplant_readiness_gate_v1',
      'taskId',v_task.id,
      'subject','fall kale',
      'readyMoveAction','pot_up',
      'readyMoveTitle','Pot up fall kale'
    ),
    'available',
    'refresh',
    null,
    case
      when nullif(v_task.metadata->>'window_end','') is not null
        then ((v_task.metadata->>'window_end')::date+1)::timestamptz
      else null
    end,
    null
  where v_task.assigned_membership_id is not null
    and not exists (
      select 1 from atlas.worker_day_cues cue
      where cue.farm_id=v_task.farm_id
        and cue.membership_id=v_task.assigned_membership_id
        and cue.status not in ('resolved','dismissed')
        and cue.payload->>'stableKey'='fall_kale_transplant_readiness_observation_v1'
    );
end;
$$;
