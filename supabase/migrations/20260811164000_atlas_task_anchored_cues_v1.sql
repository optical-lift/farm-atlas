-- Task-anchored Day cue read contract v1
-- Lets Task Focus deliver Before and After cues without turning those cues into tasks.

create or replace function atlas.worker_task_day_cues_api_v1(
  p_task_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_source text;
  v_cues jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_day is null then
    raise exception 'A Day date is required.' using errcode='22023';
  end if;

  select task.* into v_task from atlas.tasks task where task.id=p_task_id;
  if v_task.id is null or v_task.assigned_membership_id is null then
    raise exception 'Assigned task required.' using errcode='55000';
  end if;
  select fm.* into v_membership
  from atlas.farm_memberships fm
  where fm.id=v_task.assigned_membership_id and fm.farm_id=v_task.farm_id and fm.active=true;
  if v_membership.id is null then
    raise exception 'Active assignee required.' using errcode='55000';
  end if;

  if v_membership.user_id=auth.uid() then
    v_source:='worker_self';
  elsif exists (
    select 1 from atlas.farm_memberships owner_membership
    where owner_membership.farm_id=v_task.farm_id
      and owner_membership.active=true
      and owner_membership.role='owner'
      and owner_membership.user_id=auth.uid()
  ) then
    v_source:='owner_view';
  else
    raise exception 'Task cue access required.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cueId',cue.id,
    'serviceDate',cue.service_date,
    'cueKind',cue.cue_kind,
    'anchorKind',cue.anchor_kind,
    'anchorTaskId',cue.anchor_task_id,
    'title',cue.title,
    'body',cue.body,
    'payload',cue.payload,
    'status',cue.status,
    'recoveryPolicy',cue.recovery_policy,
    'availableFrom',cue.available_from,
    'expiresAt',cue.expires_at,
    'response',cue.response,
    'resolvedAt',cue.resolved_at
  ) order by case cue.anchor_kind when 'before_task' then 0 else 1 end,cue.created_at,cue.id),'[]'::jsonb)
  into v_cues
  from atlas.worker_day_cues cue
  where cue.anchor_task_id=p_task_id
    and cue.membership_id=v_membership.id
    and cue.service_date=p_day
    and cue.anchor_kind in ('before_task','after_task')
    and cue.status not in ('resolved','dismissed');

  return jsonb_build_object(
    'contractVersion','worker_task_day_cues_v1',
    'taskId',p_task_id,
    'serviceDate',p_day,
    'targetSource',v_source,
    'cues',v_cues
  );
end;
$$;

revoke all on function atlas.worker_task_day_cues_api_v1(uuid,date) from public, anon;
grant execute on function atlas.worker_task_day_cues_api_v1(uuid,date) to authenticated, service_role;

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
  'atlas.worker_task_day_cues_api_v1(uuid, date)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'purpose','Read before-task and after-task Day cues for one assigned Task Focus',
    'boundary','assigned worker or farm Owner only',
    'separation','cues remain delivery choreography and never become task instructions'
  ),
  now()
)
on conflict (signature) do update
set classification = excluded.classification,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    authenticated_execute_expected = excluded.authenticated_execute_expected,
    security_definer_expected = excluded.security_definer_expected,
    service_execute_expected = excluded.service_execute_expected,
    caller_count = excluded.caller_count,
    policy_reference_count = excluded.policy_reference_count,
    evidence = excluded.evidence,
    reviewed_at = excluded.reviewed_at;
