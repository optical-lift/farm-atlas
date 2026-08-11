-- Noel ↔ Atlas transition-context seam v1
-- Atlas exposes operational transition context to Owner-side Noel workflows.
-- Noel does not write farm priority/state here, and a somatic selection remains
-- an Owner-mediated Day cue attachment rather than farm-state evidence.

create or replace function atlas.owner_task_noel_transition_context_api_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_capacity atlas.task_capacity_profiles%rowtype;
  v_projects jsonb:='[]'::jsonb;
  v_objects jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=p_task_id;
  if v_task.id is null then
    raise exception 'Task was not found.' using errcode='P0002';
  end if;

  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.farm_id=v_task.farm_id
      and fm.active=true
      and fm.role='owner'
      and fm.user_id=auth.uid()
  ) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;

  select * into v_capacity
  from atlas.task_capacity_profiles capacity
  where capacity.task_id=v_task.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'projectId',project.id,
    'title',project.title,
    'portfolioType',project.portfolio_type,
    'targetDate',project.target_date,
    'linkRole',link.link_role,
    'sortOrder',link.sort_order
  ) order by link.sort_order,project.title),'[]'::jsonb)
  into v_projects
  from atlas.project_task_links link
  join atlas.projects project on project.id=link.project_id
  where link.task_id=v_task.id
    and project.status<>'archived';

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'objectId',link.object_id,
    'role',link.role,
    'lifeStatus',state.life_status,
    'weedPressure',state.weed_pressure,
    'waterStatus',state.water_status,
    'careState',state.care_state,
    'carePressure',state.care_pressure,
    'operationalTruth',state.operational_truth,
    'presentability',state.presentability,
    'decisionRequired',state.decision_required
  )) order by link.created_at,link.object_id),'[]'::jsonb)
  into v_objects
  from atlas.task_objects link
  left join atlas.object_state state
    on state.object_id=link.object_id
   and state.farm_id=v_task.farm_id
  where link.task_id=v_task.id;

  return jsonb_build_object(
    'contractVersion','atlas_noel_transition_context_v1',
    'taskId',v_task.id,
    'farmId',v_task.farm_id,
    'taskContext',jsonb_strip_nulls(jsonb_build_object(
      'taskType',v_task.task_type,
      'actionKey',v_task.action_key,
      'operationClass',v_task.operation_class,
      'workClass',v_task.work_class,
      'workLane',v_task.work_lane,
      'title',v_task.title,
      'location',coalesce(
        nullif(v_task.metadata->>'display_location',''),
        nullif(v_task.metadata->>'collection_zone',''),
        nullif(v_task.metadata->>'execution_place','')
      )
    )),
    'workCharacter',jsonb_strip_nulls(jsonb_build_object(
      'expectedActiveMinutes',v_capacity.expected_active_minutes,
      'physicalLoad',v_capacity.physical_load,
      'obligationClass',v_capacity.base_obligation_class,
      'microRoundKey',v_capacity.micro_round_key,
      'workRhythm',v_task.metadata->>'work_rhythm'
    )),
    'projectContext',v_projects,
    'farmTransition',jsonb_build_object(
      'beforeState',v_objects,
      'intendedAfter',nullif(v_task.metadata->>'state_effect',''),
      'completionMeaning',coalesce(
        nullif(v_task.metadata->>'execution_done_when',''),
        nullif(v_task.unlock_text,'')
      ),
      'transitionType',coalesce(
        nullif(v_task.action_key,''),
        nullif(v_task.task_type,''),
        'task_completion'
      )
    ),
    'separation',jsonb_build_object(
      'atlasOwnsFarmPriority',true,
      'noelCandidateSelectionIsOwnerMediated',true,
      'somaticSelectionIsNotFarmStateEvidence',true,
      'somaticAttachmentStorage','worker_day_cues:cue_kind=somatic'
    )
  );
end;
$$;

revoke all on function atlas.owner_task_noel_transition_context_api_v1(uuid) from public,anon;
grant execute on function atlas.owner_task_noel_transition_context_api_v1(uuid) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry (
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  reviewed_at
)
values (
  'atlas.owner_task_noel_transition_context_api_v1(uuid)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'purpose','Expose Owner-scoped Atlas transition context for later Noel completion-practice candidate generation',
    'boundary','farm Owner only',
    'separation','read-only operational context; somatic selection is not farm-state evidence'
  ),
  now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;
