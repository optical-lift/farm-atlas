create or replace function atlas.emit_germination_observation_v1(p_task_id uuid, p_action text, p_note text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_cycle_id uuid;
  v_event_id uuid;
  v_count integer:=0;
  v_action text:=lower(btrim(coalesce(p_action,'')));
begin
  if v_action not in ('not_yet','beginning','germinated','failed','failed_or_uncertain','problem_found') then
    raise exception 'Unsupported germination observation.' using errcode='22023';
  end if;
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then raise exception 'Germination task not found.' using errcode='P0002'; end if;

  for v_cycle_id in select distinct tcc.crop_cycle_id from atlas.task_crop_cycles tcc where tcc.task_id=v_task.id loop
    insert into atlas.workflow_events(farm_id,event_key,source_kind,source_id,source_key,source_event,event_date,payload)
    values(
      v_task.farm_id,
      'germination-observation:'||v_task.id::text||':'||v_cycle_id::text||':'||v_action||':'||coalesce(v_task.updated_at,now())::text,
      'crop_cycle',v_cycle_id,v_cycle_id::text,'germination_observed:'||v_action,
      (now() at time zone 'America/Chicago')::date,
      jsonb_build_object('taskId',v_task.id,'action',v_action,'note',nullif(btrim(coalesce(p_note,'')),''),'physicalObservationRecorded',true,'timeClaimsPhysicalCondition',false)
    ) on conflict (farm_id,event_key) do update set payload=excluded.payload
    returning id into v_event_id;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('events',v_count,'lastEventId',v_event_id);
end;
$function$;

create or replace function atlas.record_failed_germination_core_v1(
  p_farm_id uuid,
  p_task_id uuid,
  p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_now timestamptz := now();
  v_transition jsonb;
  v_object record;
  v_decision_task_id uuid;
  v_decision_ids jsonb := '[]'::jsonb;
  v_cycle_ids jsonb := '[]'::jsonb;
  v_note text := 'Germination failed. The planting is closed and the bed is open for a new crop decision.';
begin
  if p_farm_id is null or p_task_id is null then
    raise exception 'Farm and germination task are required.' using errcode='22023';
  end if;

  select * into v_task
  from atlas.tasks
  where id=p_task_id and farm_id=p_farm_id
  for update;

  if v_task.id is null then
    raise exception 'Germination check task was not found.' using errcode='P0002';
  end if;
  if coalesce(v_task.metadata->>'task_style','') <> 'germination_check'
     and v_task.task_type <> 'germination_check' then
    raise exception 'This task is not a germination check.' using errcode='22023';
  end if;

  if v_task.status='done' and coalesce(v_task.metadata->>'germination_result','')='failed' then
    select coalesce(jsonb_agg(t.id order by t.created_at),'[]'::jsonb)
    into v_decision_ids
    from atlas.tasks t
    where t.farm_id=p_farm_id
      and t.generated_from='germination_failure'
      and t.generated_from_id=p_task_id;
    return jsonb_build_object(
      'action','failed','taskId',p_task_id,'bedReleased',true,
      'decisionTaskIds',v_decision_ids,'deduplicated',true
    );
  end if;

  if v_task.status <> 'open' then
    raise exception 'This germination check is no longer open.' using errcode='22023';
  end if;

  v_transition := atlas.record_task_transition_v1_internal(
    p_task_id,
    'done',
    left('germination:failed:'||p_task_id::text,160),
    null,
    v_note,
    'Observed germination failure',
    'maintain',
    'germination_check',
    jsonb_build_object(
      'germination_action','failed',
      'biological_observation',true,
      'bed_released',true,
      'operator_mode',coalesce(p_operator_mode,false)
    ),
    null
  );

  update atlas.tasks
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'germination_result','failed',
        'germination_recorded_at',v_now,
        'bed_released_for_crop_decision',true,
        'operatorMode',coalesce(p_operator_mode,false)
      ),
      updated_at=v_now
  where id=p_task_id;

  with linked as (
    select distinct cc.id
    from atlas.crop_cycles cc
    join atlas.task_crop_cycles tcc on tcc.crop_cycle_id=cc.id
    where tcc.task_id=p_task_id and cc.farm_id=p_farm_id
    union
    select cc.id
    from atlas.crop_cycles cc
    where cc.farm_id=p_farm_id
      and cc.id=case
        when coalesce(v_task.metadata->>'crop_cycle_id','') ~* '^[0-9a-f-]{36}$'
          then (v_task.metadata->>'crop_cycle_id')::uuid
        else null
      end
  ), updated as (
    update atlas.crop_cycles cc
    set lifecycle_status='archived',
        cycle_state='failed',
        germination_checked_date=coalesce(cc.germination_checked_date,v_today),
        metadata=coalesce(cc.metadata,'{}'::jsonb)||jsonb_build_object(
          'germination_result','failed',
          'germination_failed_date',v_today,
          'germination_failed_at',v_now,
          'source_germination_task_id',p_task_id,
          'bed_released_for_crop_decision',true
        ),
        updated_at=v_now
    where cc.id in (select id from linked)
      and cc.lifecycle_status in ('planned','active')
    returning cc.id,cc.object_content_id
  )
  select coalesce(jsonb_agg(id order by id),'[]'::jsonb)
  into v_cycle_ids
  from updated;

  update atlas.object_contents oc
  set status='failed',
      metadata=coalesce(oc.metadata,'{}'::jsonb)||jsonb_build_object(
        'germination_failed_date',v_today,
        'source_germination_task_id',p_task_id
      ),
      updated_at=v_now
  where oc.id in (
    select cc.object_content_id
    from atlas.crop_cycles cc
    join atlas.task_crop_cycles tcc on tcc.crop_cycle_id=cc.id
    where tcc.task_id=p_task_id and cc.object_content_id is not null
  );

  for v_object in
    select distinct go.id as object_id,go.label as object_label,go.zone_id,z.label as zone_label
    from atlas.growing_objects go
    left join atlas.zones z on z.id=go.zone_id
    where go.farm_id=p_farm_id
      and go.id in (
        select tro.object_id from atlas.task_objects tro where tro.task_id=p_task_id
        union
        select cc.object_id
        from atlas.crop_cycles cc
        join atlas.task_crop_cycles tcc on tcc.crop_cycle_id=cc.id
        where tcc.task_id=p_task_id and cc.object_id is not null
        union
        select case
          when coalesce(v_task.metadata->>'object_id','') ~* '^[0-9a-f-]{36}$'
            then (v_task.metadata->>'object_id')::uuid
          else null
        end
      )
  loop
    insert into atlas.object_state(
      object_id,farm_id,life_status,weed_pressure,water_status,
      last_touched_at,last_checked_at,decision_required,
      harvest_confidence,presentability,metadata
    ) values(
      v_object.object_id,p_farm_id,'open','unknown','unknown',
      v_today,v_today,true,'unknown','unknown',
      jsonb_build_object(
        'available_for_new_sowing',true,
        'crop_plan_status','open_decision',
        'bed_released_reason','failed_germination',
        'bed_released_date',v_today,
        'source_germination_task_id',p_task_id,
        'failed_crop_cycle_ids',v_cycle_ids
      )
    ) on conflict (object_id) do update set
      life_status='open',
      last_touched_at=greatest(coalesce(atlas.object_state.last_touched_at,v_today),v_today),
      last_checked_at=greatest(coalesce(atlas.object_state.last_checked_at,v_today),v_today),
      decision_required=true,
      metadata=coalesce(atlas.object_state.metadata,'{}'::jsonb)||jsonb_build_object(
        'available_for_new_sowing',true,
        'crop_plan_status','open_decision',
        'bed_released_reason','failed_germination',
        'bed_released_date',v_today,
        'source_germination_task_id',p_task_id,
        'failed_crop_cycle_ids',v_cycle_ids
      ),
      updated_at=v_now;

    select t.id into v_decision_task_id
    from atlas.tasks t
    where t.farm_id=p_farm_id
      and t.generated_from='germination_failure'
      and t.generated_from_id=p_task_id
      and t.metadata->>'target_object_id'=v_object.object_id::text
    order by t.created_at
    limit 1;

    if v_decision_task_id is null then
      insert into atlas.tasks(
        farm_id,zone_id,title,task_type,status,priority,due_date,
        generated_from,generated_from_id,note,metadata,
        action_key,work_class,engine_instance_key,visibility_scope,
        assigned_membership_id,task_scope,work_lane,commitment_kind,release_reason
      ) values(
        p_farm_id,v_object.zone_id,
        'Choose next crop — '||v_object.object_label,
        'owner_planning','open','high',v_today,
        'germination_failure',p_task_id,
        'Germination failed in '||v_object.object_label||'. The bed is open; choose what belongs here next before any new planting task is created.',
        jsonb_build_object(
          'task_key','germination_failure_crop_decision_'||replace(p_task_id::text,'-','')||'_'||replace(v_object.object_id::text,'-',''),
          'owner_task',true,'anna_task',false,
          'decision_scope','next_crop','crop_plan_status','open_decision',
          'display_action','Choose','display_subject','Next crop',
          'display_detail','Bed freed after failed germination',
          'collection_zone',coalesce(v_object.zone_label,'Elm Farm'),
          'location_label',v_object.object_label,'display_location',v_object.object_label,
          'target_object_id',v_object.object_id,
          'source_germination_task_id',p_task_id,
          'failed_crop_cycle_ids',v_cycle_ids,
          'bed_available',true,
          'requires_owner_crop_decision',true,
          'no_auto_resow',true
        ),
        'decide','standard',
        'crop-decision:germination-failure:'||p_task_id::text||':'||v_object.object_id::text,
        'management',null,'farm_operation','process_continuation','dependency','germination_failure'
      ) returning id into v_decision_task_id;

      insert into atlas.task_objects(task_id,object_id,role)
      values(v_decision_task_id,v_object.object_id,'target')
      on conflict do nothing;
    end if;

    v_decision_ids:=v_decision_ids||jsonb_build_array(v_decision_task_id);
  end loop;

  perform atlas.emit_germination_observation_v1(p_task_id,'failed',v_note);

  return jsonb_build_object(
    'action','failed','taskId',p_task_id,'bedReleased',true,
    'cropCycleIds',v_cycle_ids,'decisionTaskIds',v_decision_ids,
    'transition',v_transition,'deduplicated',false
  );
end;
$function$;

revoke all on function atlas.record_failed_germination_core_v1(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function atlas.record_failed_germination_core_v1(uuid,uuid,boolean) to service_role;

create or replace function atlas.record_germination_observation_for_member_v3(
  p_farm_id uuid,
  p_task_id uuid,
  p_task_title text default null::text,
  p_action text default null::text,
  p_spacing_outcome text default null::text,
  p_target_spacing_inches numeric default null::numeric,
  p_note text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_task atlas.tasks%rowtype;
  v_role text;
  v_membership_id uuid;
begin
  if v_action<>'failed' then
    return atlas.record_germination_observation_for_member_v2(
      p_farm_id,p_task_id,p_task_title,p_action,p_spacing_outcome,p_target_spacing_inches,p_note
    );
  end if;

  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership_id:=atlas.current_membership_id(p_farm_id);
  if v_role is null or v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_task
  from atlas.tasks
  where id=p_task_id and farm_id=p_farm_id
  for update;
  if v_task.id is null then raise exception 'Germination check task was not found.' using errcode='P0002'; end if;
  if v_role='farm_hand' and (v_task.visibility_scope<>'assigned_worker' or v_task.assigned_membership_id<>v_membership_id) then
    raise exception 'This germination task is not assigned to the signed-in Farm Hand.' using errcode='42501';
  end if;

  return atlas.record_failed_germination_core_v1(p_farm_id,p_task_id,false);
end;
$function$;

create or replace function atlas.owner_operator_record_germination_observation_v3(
  p_effective_membership_id uuid,
  p_task_id uuid,
  p_action text,
  p_spacing_outcome text default null::text,
  p_target_spacing_inches numeric default null::numeric,
  p_note text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_context jsonb;
  v_task atlas.tasks%rowtype;
  v_farm_id uuid;
  v_membership_id uuid;
  v_role text;
begin
  if v_action<>'failed' then
    return atlas.owner_operator_record_germination_observation_v2(
      p_effective_membership_id,p_task_id,p_action,p_spacing_outcome,p_target_spacing_inches,p_note
    );
  end if;

  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id:=(v_context->>'farmId')::uuid;
  v_membership_id:=(v_context#>>'{effective,membershipId}')::uuid;
  v_role:=v_context#>>'{effective,role}';
  if v_role not in ('owner','manager','farm_hand') then
    raise exception 'Selected account cannot record germination.' using errcode='42501';
  end if;

  select * into v_task
  from atlas.tasks
  where id=p_task_id and farm_id=v_farm_id
  for update;
  if v_task.id is null then raise exception 'Germination check task was not found.' using errcode='P0002'; end if;
  if v_role='farm_hand' and (v_task.visibility_scope<>'assigned_worker' or v_task.assigned_membership_id<>v_membership_id) then
    raise exception 'The germination task is not assigned to the selected worker.' using errcode='42501';
  end if;

  return atlas.record_failed_germination_core_v1(v_farm_id,p_task_id,true)
    || jsonb_build_object('operatorMode',true,'effectiveMembershipId',v_membership_id);
end;
$function$;

revoke all on function atlas.record_germination_observation_for_member_v3(uuid,uuid,text,text,text,numeric,text) from public, anon;
grant execute on function atlas.record_germination_observation_for_member_v3(uuid,uuid,text,text,text,numeric,text) to authenticated, service_role;

revoke all on function atlas.owner_operator_record_germination_observation_v3(uuid,uuid,text,text,numeric,text) from public, anon;
grant execute on function atlas.owner_operator_record_germination_observation_v3(uuid,uuid,text,text,numeric,text) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at,anonymous_execute_expected
)
values
(
  'atlas.record_germination_observation_for_member_v3(uuid, uuid, text, text, text, numeric, text)',
  'app_endpoint','verified','active',true,true,true,1,1,
  jsonb_build_object(
    'purpose','Record germination observations while treating explicit failure as a bed release and Owner crop-decision obligation rather than an automatic resow.',
    'caller','POST /api/atlas/germination-check',
    'authorizationBoundary','The wrapper verifies active farm membership and assigned-worker scope before delegating explicit failure to the internal bed-release command.',
    'truthBoundary','Failed germination archives the failed crop cycle, opens the bed, and requests a new crop decision; it never chooses the replacement crop.'
  ),now(),now(),false
),
(
  'atlas.owner_operator_record_germination_observation_v3(uuid, uuid, text, text, numeric, text)',
  'owner_admin_endpoint','verified','active',true,true,true,1,1,
  jsonb_build_object(
    'purpose','Provide Owner operator-mode parity for germination observations including explicit failed-planting bed release.',
    'caller','POST /api/atlas/germination-check in operator mode',
    'authorizationBoundary','The wrapper resolves the selected effective membership and enforces its farm role and assignment before delegating.',
    'truthBoundary','Operator mode changes actor context only; it does not change the crop-cycle consequence of a failed planting.'
  ),now(),now(),false
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  anonymous_execute_expected=excluded.anonymous_execute_expected,
  reviewed_at=now();
