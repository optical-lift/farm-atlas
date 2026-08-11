-- Make the worker Day readiness result contract crop-generic.
--
-- The first acceptance specimen was Fall kale, but the contract is a reusable
-- Day choreography primitive. No branch in the shared executor may write
-- Fall-kale-specific blocker/result language into another crop's farm state.

create or replace function atlas.apply_worker_day_cue_result_contract_v1(
  p_cue_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
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
  v_move_done_when text;
  v_problem_blocker_text text;
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

  v_subject:=coalesce(
    nullif(v_contract->>'subject',''),
    nullif(v_task.metadata->>'variety',''),
    nullif(v_task.metadata->>'crop',''),
    'seedlings'
  );
  v_problem_blocker_text:=coalesce(
    nullif(v_contract->>'problemBlockerText',''),
    'A readiness problem was reported for '||v_subject||'.'
  );
  v_move_done_when:=coalesce(
    nullif(v_contract->>'readyMoveDoneWhen',''),
    'The ready '||v_subject||' seedlings are potted up.'
  );

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
    update atlas.tasks
    set status='blocked',
        visibility_scope='management',
        blocker_text=v_problem_blocker_text,
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
        'execution_done_when',v_move_done_when,
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
$function$;
