begin;

-- Synthetic, rollback-only acceptance specimen. No production farm record is used
-- as the mutable subject of this test.
do $contract$
declare
  v_farm_id uuid;
  v_membership_id uuid;
  v_user_id uuid;
  v_resource_id uuid;
  v_resource_key text := '__contract_required_tool_' || replace(gen_random_uuid()::text,'-','');
  v_occurrence_id uuid;
  v_task_id uuid;
  v_service_date date := (now() at time zone 'America/Chicago')::date;
  v_original_due date;
  v_after_due date;
  v_plan jsonb;
  v_cards jsonb;
begin
  select farm.id into v_farm_id
  from atlas.farms farm
  where farm.stable_key='elm_farm';

  select membership.id,membership.user_id
  into v_membership_id,v_user_id
  from atlas.farm_memberships membership
  where membership.farm_id=v_farm_id
    and membership.worker_key='anna'
    and membership.active
  limit 1;

  if v_farm_id is null or v_membership_id is null or v_user_id is null then
    raise exception 'Contract fixture could not resolve Elm Farm / Anna.';
  end if;

  insert into atlas.resources(
    id,farm_id,stable_key,label,resource_type,resource_category,status,quantity,unit,
    restock_needed,consumable,borrow_or_owner,metadata,created_at,updated_at
  ) values (
    gen_random_uuid(),v_farm_id,v_resource_key,'Contract required tool','equipment','contract',
    'needs_repair',1,'tool',false,false,'owner',
    jsonb_build_object('contractFixture',true),now(),now()
  ) returning id into v_resource_id;

  v_occurrence_id:=atlas.plan_work_occurrence_v1(
    p_farm_id=>v_farm_id,
    p_definition_key=>'operational_eligibility_contract_v1',
    p_policy_key=>'operational_eligibility_contract_required_v1',
    p_occurrence_key=>'contract:operational-eligibility:'||gen_random_uuid()::text,
    p_title=>'Contract required-resource work',
    p_task_type=>'maintenance',
    p_due_date=>v_service_date,
    p_source_kind=>'recurring_task',
    p_source_id=>null,
    p_gate_type=>'immediate',
    p_horizon_days=>0,
    p_maximum_active_instances=>8,
    p_task_payload=>jsonb_build_object(
      'farm_id',v_farm_id,
      'title','Contract required-resource work',
      'task_type','maintenance',
      'status','open',
      'priority','normal',
      'due_date',v_service_date,
      'action_key','maintain',
      'work_class','standard',
      'work_lane','required',
      'commitment_kind','hard_date',
      'task_scope','farm_operation',
      'origin_kind','generated',
      'generated_from','recurring_task',
      'task_series_key','contract:operational-eligibility',
      'engine_instance_key','contract:'||gen_random_uuid()::text,
      'visibility_scope','assigned_worker',
      'assigned_membership_id',v_membership_id,
      'assigned_user_id',v_user_id,
      'metadata',jsonb_build_object(
        'anna_task',true,
        'assigned_to','Anna',
        'assignee_key','anna',
        'executor_worker_key','anna',
        'executor_membership_id',v_membership_id,
        'work_lane','required',
        'required_resource_keys',jsonb_build_array(v_resource_key),
        'contract_fixture',true
      )
    ),
    p_relation_payload=>'{}'::jsonb,
    p_gate_config=>jsonb_build_object('automatic',true,'contractFixture',true),
    p_not_before_date=>v_service_date,
    p_metadata=>jsonb_build_object('contractFixture',true)
  );

  update atlas.planned_work_occurrences
  set work_lane='required',updated_at=now()
  where id=v_occurrence_id;

  perform atlas.signal_work_occurrence_v1(
    v_occurrence_id,
    'operational_eligibility_contract',
    jsonb_build_object('contractFixture',true)
  );

  select released_task_id into v_task_id
  from atlas.planned_work_occurrences
  where id=v_occurrence_id;

  if v_task_id is null then
    raise exception 'Synthetic required-resource task was not released.';
  end if;

  select due_date into v_original_due from atlas.tasks where id=v_task_id;

  if atlas.task_required_resources_available_v1(v_task_id) then
    raise exception 'Unavailable required resource did not close task eligibility.';
  end if;

  v_plan:=atlas.owner_worker_day_plan_v1(v_farm_id,v_membership_id,v_service_date);
  if exists(
    select 1 from jsonb_array_elements(v_plan->'realWork') item
    where item->>'taskId'=v_task_id::text
  ) then
    raise exception 'Unavailable-resource task surfaced in Worker Day.';
  end if;

  v_cards:=atlas.worker_day_operational_task_cards_v2(
    v_farm_id,v_membership_id,v_service_date,array[v_task_id]
  );
  if exists(
    select 1 from jsonb_array_elements(v_cards) card
    where card->>'task_id'=v_task_id::text
  ) then
    raise exception 'Unavailable-resource task surfaced through explicit card hydration.';
  end if;

  update atlas.resources set status='available',updated_at=now() where id=v_resource_id;

  if not atlas.task_required_resources_available_v1(v_task_id) then
    raise exception 'Putting required resource back did not re-enable the same task.';
  end if;

  v_plan:=atlas.owner_worker_day_plan_v1(v_farm_id,v_membership_id,v_service_date);
  if not exists(
    select 1 from jsonb_array_elements(v_plan->'realWork') item
    where item->>'taskId'=v_task_id::text
  ) then
    raise exception 'Same task did not return to Worker Day when resource became available.';
  end if;

  v_cards:=atlas.worker_day_operational_task_cards_v2(
    v_farm_id,v_membership_id,v_service_date,array[v_task_id]
  );
  if not exists(
    select 1 from jsonb_array_elements(v_cards) card
    where card->>'task_id'=v_task_id::text
  ) then
    raise exception 'Same task did not return through explicit card hydration.';
  end if;

  select due_date into v_after_due from atlas.tasks where id=v_task_id;
  if v_after_due is distinct from v_original_due then
    raise exception 'Task due date changed across resource toggle.';
  end if;

  update atlas.tasks
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'temporal_gate_kind','not_before',
    'temporal_not_before_date',(v_service_date+1)::text
  ),updated_at=now()
  where id=v_task_id;

  if atlas.task_temporally_eligible_v1(v_task_id,v_service_date) then
    raise exception 'Not-before task was eligible before its threshold.';
  end if;
  if not atlas.task_temporally_eligible_v1(v_task_id,v_service_date+1) then
    raise exception 'Not-before task did not become eligible on its threshold.';
  end if;
  if not atlas.task_temporally_eligible_v1(v_task_id,v_service_date+2) then
    raise exception 'Not-before task did not remain eligible after its threshold.';
  end if;
end $contract$;

rollback;
