alter table atlas.farms add column if not exists north_star_text text;
alter table atlas.projects add column if not exists reality_state text not null default 'finding_shape';
alter table atlas.projects add column if not exists reality_state_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_reality_state_check'
      and conrelid = 'atlas.projects'::regclass
  ) then
    alter table atlas.projects
      add constraint projects_reality_state_check
      check (reality_state in ('finding_shape','making_real','closing_loop'));
  end if;
end $$;

update atlas.farms
set north_star_text = case stable_key
  when 'elm_farm' then 'Make Elm a successful, beautiful, functioning farm + gathering place.'
  when 'waiting_room_farm' then 'Create a restorative one-acre farm and lodging property for recovery, walking, and physical rehabilitation.'
  else north_star_text
end
where stable_key in ('elm_farm','waiting_room_farm');

update atlas.projects
set reality_state = case stable_key
  when 'elm_finish_renovation_pool' then 'making_real'
  when 'elm_thursdays_at_elm_program' then 'making_real'
  when 'elm_make_visible' then 'making_real'
  when 'elm_make_productive' then 'finding_shape'
  when 'elm_finish_event_spaces' then 'making_real'
  when 'elm_finish_arrival_exterior' then 'making_real'
  when 'elm_finish_gardens_visible_grounds' then 'finding_shape'
  when 'elm_finish_lounge_ready' then 'making_real'
  when 'elm_finish_conference_room_ready' then 'making_real'
  when 'elm_finish_guest_restroom_route' then 'making_real'
  when 'elm_thursdays_public_launch' then 'making_real'
  when 'elm_first_ticketed_thursday_bloom_bar_2026_08_13' then 'making_real'
  when 'elm_thursdays_operating_system' then 'finding_shape'
  when 'deer_protection_bed_boundaries' then 'making_real'
  else reality_state
end,
reality_state_reason = case stable_key
  when 'elm_finish_renovation_pool' then 'The finish line is understood; the remaining work is primarily execution and sequencing.'
  when 'elm_thursdays_at_elm_program' then 'The Thursday concept is established and is being proven through real gatherings.'
  when 'elm_make_visible' then 'The public identity is understood; the work is now releasing the next useful visibility move without building debt.'
  when 'elm_make_productive' then 'Production is active, but the durable system for protection, succession, and output is still being clarified.'
  when 'elm_finish_event_spaces' then 'The event-space outcome is clear and bounded room-level finish work remains.'
  when 'elm_finish_arrival_exterior' then 'The desired guest arrival experience is clear; remaining work is physical execution.'
  when 'elm_finish_gardens_visible_grounds' then 'The guest-facing grounds outcome is known, but the bounded sequence and finish standard are still being clarified area by area.'
  when 'elm_finish_lounge_ready' then 'The lounge finish outcome is known and awaits an on-site execution window.'
  when 'elm_finish_conference_room_ready' then 'The room outcome is clear and real event use is driving the remaining finish work.'
  when 'elm_finish_guest_restroom_route' then 'The current guest route has a defined finish standard and needs execution.'
  when 'elm_thursdays_public_launch' then 'The public invitation system is defined and being put into use.'
  when 'elm_first_ticketed_thursday_bloom_bar_2026_08_13' then 'The event format and guest experience are defined; the remaining work is execution against a hard real-world date.'
  when 'elm_thursdays_operating_system' then 'The first paid Thursday is still revealing which hospitality and operating pieces should become reusable system.'
  when 'deer_protection_bed_boundaries' then 'The deterrence and boundary system is defined and is being executed in bounded slices.'
  else reality_state_reason
end
where stable_key in (
  'elm_finish_renovation_pool','elm_thursdays_at_elm_program','elm_make_visible','elm_make_productive',
  'elm_finish_event_spaces','elm_finish_arrival_exterior','elm_finish_gardens_visible_grounds','elm_finish_lounge_ready',
  'elm_finish_conference_room_ready','elm_finish_guest_restroom_route','elm_thursdays_public_launch',
  'elm_first_ticketed_thursday_bloom_bar_2026_08_13','elm_thursdays_operating_system','deer_protection_bed_boundaries'
);

create or replace function atlas.portfolio_project_card_v1(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
  select jsonb_build_object(
    'projectId', p.id,
    'projectKey', p.stable_key,
    'title', p.title,
    'status', p.status,
    'projectKind', p.project_kind,
    'portfolioType', p.portfolio_type,
    'parentProjectId', p.parent_project_id,
    'parentProjectKey', parent.stable_key,
    'parentProjectTitle', parent.title,
    'projectPath', atlas.project_path_v1(p.id),
    'workstream', p.workstream,
    'outcome', coalesce(p.outcome_text, p.goal_text),
    'currentMilestone', p.current_milestone,
    'health', p.health_status,
    'realityState', p.reality_state,
    'realityStateReason', p.reality_state_reason,
    'targetDate', p.target_date,
    'lastMovementAt', p.last_movement_at,
    'farmId', f.id,
    'farmKey', f.stable_key,
    'farmName', f.name,
    'myRole', (select pc.contribution_role from atlas.project_contributors pc where pc.project_id=p.id and pc.user_id=auth.uid() and pc.active=true limit 1),
    'canCreateTasks', atlas.can_contribute_to_project(p.id),
    'openTaskCount', (select count(*) from atlas.project_task_links ptl join atlas.tasks t on t.id=ptl.task_id where ptl.project_id=p.id and t.status in ('open','blocked')),
    'blockedTaskCount', (select count(*) from atlas.project_task_links ptl join atlas.tasks t on t.id=ptl.task_id where ptl.project_id=p.id and t.status='blocked'),
    'openAttentionCount', (select count(*) from atlas.project_attention_items pai where pai.project_id=p.id and pai.status='open'),
    'targets', coalesce((select jsonb_agg(jsonb_build_object('targetRole',pt.target_role,'farmId',tf.id,'farmName',tf.name,'placeId',pl.id,'placeLabel',pl.label,'placeType',pl.place_type,'zoneId',z.id,'zoneLabel',z.label) order by pt.created_at) from atlas.project_targets pt left join atlas.farms tf on tf.id=pt.farm_id left join atlas.places pl on pl.id=pt.place_id left join atlas.zones z on z.id=pt.zone_id where pt.project_id=p.id),'[]'::jsonb),
    'trail', atlas.project_trail_context_v2(p.id)
  )
  from atlas.projects p
  left join atlas.projects parent on parent.id=p.parent_project_id
  left join atlas.farms f on f.id=p.farm_id
  where p.id=p_project_id;
$function$;

create or replace function atlas.owner_operator_project_card_v1(p_effective_account_id uuid, p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context jsonb;
  v_user_id uuid;
  v_result jsonb;
begin
  v_context := atlas.owner_operator_accounts_v1(p_effective_account_id);
  v_user_id := (v_context #>> '{effective,userId}')::uuid;
  if not atlas.owner_operator_project_access_v1(p_effective_account_id, p_project_id, 'read') then
    raise exception 'Project access is not active in the selected account.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'projectId', p.id,
    'projectKey', p.stable_key,
    'title', p.title,
    'status', p.status,
    'projectKind', p.project_kind,
    'portfolioType', p.portfolio_type,
    'parentProjectId', p.parent_project_id,
    'parentProjectKey', parent.stable_key,
    'parentProjectTitle', parent.title,
    'projectPath', atlas.project_path_v1(p.id),
    'workstream', p.workstream,
    'outcome', coalesce(p.outcome_text, p.goal_text),
    'currentMilestone', p.current_milestone,
    'health', p.health_status,
    'realityState', p.reality_state,
    'realityStateReason', p.reality_state_reason,
    'targetDate', p.target_date,
    'lastMovementAt', p.last_movement_at,
    'farmId', f.id,
    'farmKey', f.stable_key,
    'farmName', f.name,
    'myRole', coalesce((
      select case when om.role = 'owner' then 'owner' else pc.contribution_role end
      from atlas.organization_memberships om
      left join atlas.project_contributors pc on pc.project_id = p.id and pc.user_id = v_user_id and pc.active = true
      where om.organization_id = p.organization_id and om.user_id = v_user_id and om.active = true
      limit 1
    ), 'member'),
    'canCreateTasks', atlas.owner_operator_project_access_v1(p_effective_account_id, p.id, 'create'),
    'openTaskCount', (
      select count(*) from atlas.project_task_links ptl join atlas.tasks t on t.id = ptl.task_id
      where ptl.project_id = p.id and t.status in ('open','blocked')
    ),
    'blockedTaskCount', (
      select count(*) from atlas.project_task_links ptl join atlas.tasks t on t.id = ptl.task_id
      where ptl.project_id = p.id and t.status = 'blocked'
    ),
    'openAttentionCount', (
      select count(*) from atlas.project_attention_items pai
      where pai.project_id = p.id and pai.status = 'open'
    ),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'targetRole', pt.target_role,
        'farmId', tf.id,
        'farmName', tf.name,
        'placeId', pl.id,
        'placeLabel', pl.label,
        'placeType', pl.place_type,
        'zoneId', z.id,
        'zoneLabel', z.label
      ) order by pt.created_at)
      from atlas.project_targets pt
      left join atlas.farms tf on tf.id = pt.farm_id
      left join atlas.places pl on pl.id = pt.place_id
      left join atlas.zones z on z.id = pt.zone_id
      where pt.project_id = p.id
    ), '[]'::jsonb),
    'trail', atlas.project_trail_context_v2(p.id)
  ) into v_result
  from atlas.projects p
  left join atlas.projects parent on parent.id = p.parent_project_id
  left join atlas.farms f on f.id = p.farm_id
  where p.id = p_project_id;

  return v_result;
end;
$function$;

create or replace function atlas.portfolio_home_v1(p_organization_id uuid default null::uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_role text;
  v_result jsonb;
begin
  select om.organization_id, om.role
  into v_organization_id, v_role
  from atlas.organization_memberships om
  where om.user_id = v_user_id
    and om.active = true
    and (p_organization_id is null or om.organization_id = p_organization_id)
  order by case when om.role = 'owner' then 0 else 1 end, om.created_at
  limit 1;

  if v_organization_id is null then
    raise exception 'An active Feast Guild membership is required.' using errcode = '42501';
  end if;

  with visible_projects as (
    select p.*
    from atlas.projects p
    where p.organization_id = v_organization_id
      and p.status <> 'archived'
      and (
        v_role = 'owner'
        or exists (
          select 1 from atlas.project_contributors pc
          where pc.project_id = p.id and pc.user_id = v_user_id and pc.active = true
        )
      )
  )
  select jsonb_build_object(
    'organization', jsonb_build_object('organizationId', o.id,'organizationKey', o.stable_key,'name', o.name),
    'viewer', jsonb_build_object('role', v_role,'isOwner', v_role = 'owner'),
    'workstreams', coalesce((select jsonb_agg(workstream order by workstream) from (select distinct vp.workstream from visible_projects vp) ws), '[]'::jsonb),
    'attention', coalesce((
      select jsonb_agg(item order by sort_date nulls last, title)
      from (
        select jsonb_build_object('attentionId', pai.id,'kind', pai.attention_type,'title', pai.title,'detail', pai.detail,'dueDate', pai.due_date,'projectId', vp.id,'projectTitle', vp.title,'farmName', f.name) as item, pai.due_date as sort_date, pai.title
        from visible_projects vp join atlas.project_attention_items pai on pai.project_id = vp.id and pai.status = 'open' left join atlas.farms f on f.id = vp.farm_id
        union all
        select jsonb_build_object('attentionId', null,'kind', 'blocked','title', t.title,'detail', coalesce(t.blocker_text, 'This project task is blocked.'),'dueDate', t.due_date,'projectId', vp.id,'projectTitle', vp.title,'farmName', f.name), t.due_date, t.title
        from visible_projects vp join atlas.project_task_links ptl on ptl.project_id = vp.id join atlas.tasks t on t.id = ptl.task_id and t.status = 'blocked' left join atlas.farms f on f.id = vp.farm_id
        union all
        select jsonb_build_object('attentionId', null,'kind', 'deadline_risk','title', t.title,'detail', 'This project task is past its due date.','dueDate', t.due_date,'projectId', vp.id,'projectTitle', vp.title,'farmName', f.name), t.due_date, t.title
        from visible_projects vp join atlas.project_task_links ptl on ptl.project_id = vp.id join atlas.tasks t on t.id = ptl.task_id left join atlas.farms f on f.id = vp.farm_id
        where t.status = 'open' and t.due_date < current_date
      ) attention_rows
    ), '[]'::jsonb),
    'crossFarmProjects', coalesce((select jsonb_agg(atlas.portfolio_project_card_v1(vp.id) order by vp.sort_order, vp.title) from visible_projects vp where vp.farm_id is null), '[]'::jsonb),
    'farms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'farmId', f.id,
        'farmKey', f.stable_key,
        'farmName', f.name,
        'status', f.status,
        'northStar', f.north_star_text,
        'locationLabel', f.metadata->>'location_label',
        'facts', f.metadata,
        'projects', coalesce((select jsonb_agg(atlas.portfolio_project_card_v1(vp.id) order by vp.workstream, vp.sort_order, vp.title) from visible_projects vp where vp.farm_id = f.id), '[]'::jsonb)
      ) order by f.name)
      from atlas.farms f
      where f.organization_id = v_organization_id and f.status = 'active'
        and (v_role = 'owner' or exists (select 1 from visible_projects vp where vp.farm_id = f.id))
    ), '[]'::jsonb)
  ) into v_result
  from atlas.organizations o where o.id = v_organization_id;

  return v_result;
end;
$function$;

create or replace function atlas.set_project_reality_state_v1(
  p_project_id uuid,
  p_reality_state text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_project atlas.projects%rowtype;
  v_state text := lower(trim(coalesce(p_reality_state,'')));
  v_reason text := nullif(trim(coalesce(p_reason,'')), '');
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if v_state not in ('finding_shape','making_real','closing_loop') then
    raise exception 'Choose finding_shape, making_real, or closing_loop.' using errcode='22023';
  end if;
  if v_reason is not null and length(v_reason) > 1000 then
    raise exception 'Reality-state reason must be 1000 characters or fewer.' using errcode='22023';
  end if;

  select * into v_project from atlas.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'Project not found.' using errcode='P0002';
  end if;
  if not exists (
    select 1 from atlas.organization_memberships om
    where om.organization_id = v_project.organization_id
      and om.user_id = v_user_id
      and om.active = true
      and om.role = 'owner'
  ) then
    raise exception 'Only the organization Owner may change a project reality state.' using errcode='42501';
  end if;

  update atlas.projects
  set reality_state = v_state,
      reality_state_reason = v_reason,
      last_movement_at = now(),
      updated_at = now()
  where id = p_project_id;

  return jsonb_build_object(
    'projectId', p_project_id,
    'realityState', v_state,
    'realityStateReason', v_reason,
    'updatedAt', now()
  );
end;
$function$;

revoke all on function atlas.set_project_reality_state_v1(uuid,text,text) from public, anon;
grant execute on function atlas.set_project_reality_state_v1(uuid,text,text) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, registered_at, reviewed_at
) values (
  'atlas.set_project_reality_state_v1(uuid,text,text)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object('purpose','Owner-governed project certainty state for the multi-farm reality map','migration','multifarm_reality_projects_v1'),
  now(),now()
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
  reviewed_at=now();
