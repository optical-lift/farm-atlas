-- Atlas project pull pool v1
-- Durable project work stays undated. A worker explicitly pulls one item into a dated
-- executable task for today. All objects live in the atlas schema because Noel shares
-- this Supabase project and must remain untouched.

create table if not exists atlas.project_pull_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references atlas.projects(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  organization_id uuid not null references atlas.organizations(id) on delete restrict,
  source_task_id uuid references atlas.tasks(id) on delete set null,
  title text not null,
  note text,
  status text not null default 'available' check (status in ('available','selected','blocked','completed','archived')),
  preferred_membership_id uuid references atlas.farm_memberships(id) on delete set null,
  expected_active_minutes integer not null default 30 check (expected_active_minutes > 0 and expected_active_minutes <= 720),
  physical_load text not null default 'moderate' check (physical_load in ('light','moderate','heavy')),
  work_class text,
  environment text not null default 'either' check (environment in ('indoor','outdoor','either')),
  location_text text,
  priority text not null default 'normal',
  active_task_id uuid references atlas.tasks(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, source_task_id)
);

create index if not exists project_pull_items_project_status_idx
  on atlas.project_pull_items(project_id, status, preferred_membership_id);
create index if not exists project_pull_items_farm_idx
  on atlas.project_pull_items(farm_id, status);

create table if not exists atlas.project_pull_item_dependencies (
  id uuid primary key default gen_random_uuid(),
  project_item_id uuid not null references atlas.project_pull_items(id) on delete cascade,
  prerequisite_item_id uuid not null references atlas.project_pull_items(id) on delete cascade,
  required_status text not null default 'completed' check (required_status = 'completed'),
  created_at timestamptz not null default now(),
  check (project_item_id <> prerequisite_item_id),
  unique (project_item_id, prerequisite_item_id)
);

create table if not exists atlas.project_pull_selections (
  id uuid primary key default gen_random_uuid(),
  project_item_id uuid not null references atlas.project_pull_items(id) on delete cascade,
  project_id uuid not null references atlas.projects(id) on delete cascade,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  service_date date not null,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  state text not null default 'selected' check (state in ('selected','returned','completed')),
  selected_at timestamptz not null default now(),
  returned_at timestamptz,
  completed_at timestamptz,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  unique (project_item_id, task_id)
);

create index if not exists project_pull_selections_member_day_idx
  on atlas.project_pull_selections(membership_id, service_date, state);

alter table atlas.project_pull_items enable row level security;
alter table atlas.project_pull_item_dependencies enable row level security;
alter table atlas.project_pull_selections enable row level security;

revoke all on atlas.project_pull_items from anon, authenticated;
revoke all on atlas.project_pull_item_dependencies from anon, authenticated;
revoke all on atlas.project_pull_selections from anon, authenticated;
grant select on atlas.project_pull_items to authenticated;
grant select on atlas.project_pull_item_dependencies to authenticated;
grant select on atlas.project_pull_selections to authenticated;
grant all on atlas.project_pull_items to service_role;
grant all on atlas.project_pull_item_dependencies to service_role;
grant all on atlas.project_pull_selections to service_role;

create policy project_pull_items_read_v1 on atlas.project_pull_items
for select to authenticated
using (atlas.can_read_project(project_id));

create policy project_pull_dependencies_read_v1 on atlas.project_pull_item_dependencies
for select to authenticated
using (exists (
  select 1 from atlas.project_pull_items item
  where item.id = project_item_id
    and atlas.can_read_project(item.project_id)
));

create policy project_pull_selections_read_v1 on atlas.project_pull_selections
for select to authenticated
using (
  exists (
    select 1 from atlas.farm_memberships membership
    where membership.id = membership_id
      and membership.active
      and membership.user_id = auth.uid()
  )
  or atlas.is_farm_owner(farm_id)
);

create or replace function atlas.project_pull_options_for_member_v1(
  p_project_id uuid,
  p_membership_id uuid,
  p_day date default null,
  p_limit integer default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_day date := coalesce(p_day,(now() at time zone 'America/Chicago')::date);
  v_membership atlas.farm_memberships%rowtype;
  v_project atlas.projects%rowtype;
  v_settings atlas.member_capacity_settings%rowtype;
  v_regular_minutes integer := 0;
  v_heavy_minutes integer := 0;
  v_regular_target integer;
  v_heavy_cap integer;
  v_remaining integer;
  v_budget integer;
  v_limit integer;
  v_options jsonb := '[]'::jsonb;
begin
  select * into v_membership
  from atlas.farm_memberships
  where id=p_membership_id and active;
  if v_membership.id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_project from atlas.projects where id=p_project_id and status='active';
  if v_project.id is null or v_project.farm_id is distinct from v_membership.farm_id then
    raise exception 'Active project is not available to this membership.' using errcode='P0002';
  end if;

  if auth.uid() is not null
     and v_membership.user_id <> auth.uid()
     and not atlas.is_farm_owner(v_membership.farm_id) then
    raise exception 'Only the member or farm owner may view project pull options.' using errcode='42501';
  end if;

  select * into v_settings from atlas.member_capacity_settings
  where membership_id=v_membership.id and farm_id=v_membership.farm_id and active;

  v_regular_target := coalesce(v_settings.regular_target_minutes,
    case v_membership.role when 'farm_hand' then 300 when 'manager' then 360 else 480 end);
  v_heavy_cap := coalesce(v_settings.heavy_minutes_soft_cap,
    case v_membership.role when 'farm_hand' then 210 when 'manager' then 240 else 300 end);

  select
    coalesce(sum(capacity.expected_active_minutes) filter (
      where presented.presentation_state='presented'
        and capacity.effective_obligation_class <> 'recovery_work'
    ),0)::integer,
    coalesce(sum(capacity.expected_active_minutes) filter (
      where presented.presentation_state='presented'
        and capacity.effective_obligation_class <> 'recovery_work'
        and capacity.physical_load='heavy'
    ),0)::integer
  into v_regular_minutes,v_heavy_minutes
  from atlas.presented_work_rows_v1(v_membership.farm_id,v_membership.id,v_day) presented
  join atlas.tasks task on task.id=presented.task_id
  cross join lateral atlas.task_capacity_plan_v1(task,v_day) capacity;

  v_remaining := greatest(v_regular_target-v_regular_minutes,0);
  v_budget := least(
    coalesce(nullif((v_project.metadata->>'daily_pull_minutes')::integer,0),90),
    greatest(v_remaining,0)
  );
  v_limit := least(greatest(coalesce(p_limit,nullif((v_project.metadata->>'daily_pull_choice_limit')::integer,0),8),1),12);

  select coalesce(jsonb_agg(row.payload order by row.fit_rank,row.priority_rank,row.expected_active_minutes,row.title),'[]'::jsonb)
  into v_options
  from (
    select
      item.title,
      item.expected_active_minutes,
      case when item.expected_active_minutes <= v_budget
             and not (item.physical_load='heavy' and v_heavy_minutes >= v_heavy_cap)
           then 0 else 1 end as fit_rank,
      case item.priority when 'critical' then 0 when 'urgent' then 0 when 'high' then 1 when 'low' then 3 else 2 end as priority_rank,
      jsonb_build_object(
        'projectItemId',item.id,
        'title',item.title,
        'note',item.note,
        'expectedActiveMinutes',item.expected_active_minutes,
        'physicalLoad',item.physical_load,
        'workClass',item.work_class,
        'environment',item.environment,
        'location',item.location_text,
        'priority',item.priority,
        'fitsToday',item.expected_active_minutes <= v_budget
          and not (item.physical_load='heavy' and v_heavy_minutes >= v_heavy_cap)
      ) as payload
    from atlas.project_pull_items item
    where item.project_id=p_project_id
      and item.farm_id=v_membership.farm_id
      and item.status='available'
      and (item.preferred_membership_id is null or item.preferred_membership_id=v_membership.id)
      and not exists (
        select 1
        from atlas.project_pull_item_dependencies dependency
        join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
        where dependency.project_item_id=item.id
          and prerequisite.status <> dependency.required_status
      )
      and not exists (
        select 1 from atlas.project_pull_selections selection
        where selection.project_item_id=item.id and selection.state='selected'
      )
    order by fit_rank,priority_rank,item.expected_active_minutes,item.title
    limit v_limit
  ) row;

  return jsonb_build_object(
    'contractVersion','project_pull_options_v1',
    'projectId',v_project.id,
    'projectTitle',v_project.title,
    'membershipId',v_membership.id,
    'serviceDate',v_day,
    'capacity',jsonb_build_object(
      'regularTargetMinutes',v_regular_target,
      'alreadyPresentedRegularMinutes',v_regular_minutes,
      'remainingRegularMinutes',v_remaining,
      'heavyMinutesSoftCap',v_heavy_cap,
      'alreadyPresentedHeavyMinutes',v_heavy_minutes,
      'projectPullBudgetMinutes',v_budget
    ),
    'options',v_options
  );
end;
$function$;

create or replace function atlas.pull_project_item_to_today_v1(
  p_project_item_id uuid,
  p_membership_id uuid,
  p_day date default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_day date := coalesce(p_day,(now() at time zone 'America/Chicago')::date);
  v_item atlas.project_pull_items%rowtype;
  v_membership atlas.farm_memberships%rowtype;
  v_source atlas.tasks%rowtype;
  v_task_id uuid;
  v_effort numeric;
begin
  select * into v_item from atlas.project_pull_items where id=p_project_item_id for update;
  if v_item.id is null then raise exception 'Project item not found.' using errcode='P0002'; end if;
  if v_item.status <> 'available' then raise exception 'Project item is not available.' using errcode='55000'; end if;

  select * into v_membership from atlas.farm_memberships
  where id=p_membership_id and farm_id=v_item.farm_id and active;
  if v_membership.id is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if v_item.preferred_membership_id is not null and v_item.preferred_membership_id <> v_membership.id then
    raise exception 'Project item is assigned to a different member.' using errcode='42501';
  end if;
  if auth.uid() is not null and v_membership.user_id <> auth.uid() and not atlas.is_farm_owner(v_item.farm_id) then
    raise exception 'Only the member or farm owner may pull this work.' using errcode='42501';
  end if;
  if exists (
    select 1 from atlas.project_pull_item_dependencies dependency
    join atlas.project_pull_items prerequisite on prerequisite.id=dependency.prerequisite_item_id
    where dependency.project_item_id=v_item.id and prerequisite.status <> dependency.required_status
  ) then
    raise exception 'Project item still has an unfinished prerequisite.' using errcode='55000';
  end if;

  if v_item.source_task_id is not null then
    select * into v_source from atlas.tasks where id=v_item.source_task_id;
  end if;
  v_effort := coalesce(v_source.effort_units,
    case when v_item.expected_active_minutes <= 30 then 0.5 when v_item.expected_active_minutes > 120 then 2 else 1 end);

  insert into atlas.tasks (
    farm_id,organization_id,zone_id,title,task_type,status,priority,due_date,unlock_text,blocker_text,
    generated_from,generated_from_id,note,metadata,action_key,work_class,parent_task_id,visibility_scope,
    assigned_membership_id,assigned_user_id,created_by_user_id,origin_kind,task_scope,work_lane,commitment_kind,effort_units
  ) values (
    v_item.farm_id,v_item.organization_id,v_source.zone_id,v_item.title,coalesce(v_source.task_type,'project_pull'),'open',
    coalesce(v_item.priority,v_source.priority,'normal'),v_day,v_source.unlock_text,null,
    'project_pull_item',v_item.id,coalesce(v_item.note,v_source.note),
    coalesce(v_source.metadata,'{}'::jsonb) || jsonb_build_object(
      'project_pull_item_id',v_item.id,
      'project_id',v_item.project_id,
      'project_pull_service_date',v_day,
      'project_pull_source_task_id',v_item.source_task_id
    ),
    v_source.action_key,coalesce(v_item.work_class,v_source.work_class,'standard'),null,
    coalesce(v_source.visibility_scope,'assigned_worker'),v_membership.id,v_membership.user_id,auth.uid(),
    'generated','farm_operation','discretionary','floating',v_effort
  ) returning id into v_task_id;

  insert into atlas.task_objects(task_id,object_id,role)
  select v_task_id,object_id,role from atlas.task_objects where task_id=v_item.source_task_id
  on conflict do nothing;

  insert into atlas.task_capacity_profiles(
    task_id,farm_id,expected_active_minutes,physical_load,base_obligation_class,micro_round_key,
    estimate_source,estimate_confidence,recovery_origin_due_date,owner_locked,owner_note,metadata
  ) values (
    v_task_id,v_item.farm_id,v_item.expected_active_minutes,v_item.physical_load,'optional_improvement',null,
    'project_pull_item','owner_confirmed',null,true,'Pulled from durable project pool.',
    jsonb_build_object('project_pull_item_id',v_item.id)
  ) on conflict (task_id) do nothing;

  insert into atlas.project_task_links(project_id,task_id,link_role,sort_order,source,metadata)
  values (v_item.project_id,v_task_id,'daily_pull',100,'project_pull',jsonb_build_object('project_pull_item_id',v_item.id))
  on conflict do nothing;

  insert into atlas.project_pull_selections(project_item_id,project_id,farm_id,membership_id,service_date,task_id,state,note)
  values (v_item.id,v_item.project_id,v_item.farm_id,v_membership.id,v_day,v_task_id,'selected',p_note);

  update atlas.project_pull_items
  set status='selected',active_task_id=v_task_id,updated_at=now()
  where id=v_item.id;

  return jsonb_build_object('contractVersion','project_pull_selection_v1','projectItemId',v_item.id,'taskId',v_task_id,'serviceDate',v_day,'state','selected');
end;
$function$;

create or replace function atlas.return_project_item_to_pool_v1(
  p_task_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_item_id uuid;
  v_item atlas.project_pull_items%rowtype;
  v_membership atlas.farm_memberships%rowtype;
begin
  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;
  v_item_id := nullif(v_task.metadata->>'project_pull_item_id','')::uuid;
  if v_item_id is null then raise exception 'Task is not a project pull task.' using errcode='22023'; end if;
  select * into v_item from atlas.project_pull_items where id=v_item_id for update;
  select * into v_membership from atlas.farm_memberships where id=v_task.assigned_membership_id and active;
  if auth.uid() is not null and coalesce(v_membership.user_id,'00000000-0000-0000-0000-000000000000'::uuid) <> auth.uid()
     and not atlas.is_farm_owner(v_task.farm_id) then
    raise exception 'Only the assigned member or farm owner may return this work.' using errcode='42501';
  end if;
  if v_task.status not in ('open','blocked') then raise exception 'Only open or blocked work can return to the pool.' using errcode='55000'; end if;

  update atlas.tasks
  set status='archived',due_date=null,completed_at=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('project_pull_returned_at',now(),'project_pull_return_note',p_note),
      updated_at=now()
  where id=v_task.id;

  update atlas.project_pull_selections
  set state='returned',returned_at=now(),note=coalesce(p_note,note)
  where task_id=v_task.id and state='selected';

  update atlas.project_pull_items
  set status='available',active_task_id=null,updated_at=now()
  where id=v_item.id;

  return jsonb_build_object('contractVersion','project_pull_return_v1','projectItemId',v_item.id,'taskId',v_task.id,'state','available');
end;
$function$;

create or replace function atlas.sync_project_pull_item_from_task_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_item_id uuid;
begin
  v_item_id := nullif(new.metadata->>'project_pull_item_id','')::uuid;
  if v_item_id is null then return new; end if;

  if new.status='done' and old.status is distinct from new.status then
    update atlas.project_pull_items set status='completed',active_task_id=null,updated_at=now() where id=v_item_id;
    update atlas.project_pull_selections set state='completed',completed_at=coalesce(new.completed_at,now()) where task_id=new.id and state='selected';
  elsif new.status in ('archived','skipped') and old.status is distinct from new.status then
    update atlas.project_pull_items set status='available',active_task_id=null,updated_at=now() where id=v_item_id and status='selected';
    update atlas.project_pull_selections set state='returned',returned_at=now() where task_id=new.id and state='selected';
  end if;
  return new;
end;
$function$;

drop trigger if exists sync_project_pull_item_from_task_v1 on atlas.tasks;
create trigger sync_project_pull_item_from_task_v1
after update of status on atlas.tasks
for each row execute function atlas.sync_project_pull_item_from_task_v1();

revoke all on function atlas.project_pull_options_for_member_v1(uuid,uuid,date,integer) from public;
revoke all on function atlas.pull_project_item_to_today_v1(uuid,uuid,date,text) from public;
revoke all on function atlas.return_project_item_to_pool_v1(uuid,text) from public;
grant execute on function atlas.project_pull_options_for_member_v1(uuid,uuid,date,integer) to authenticated,service_role;
grant execute on function atlas.pull_project_item_to_today_v1(uuid,uuid,date,text) to authenticated,service_role;
grant execute on function atlas.return_project_item_to_pool_v1(uuid,text) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,
  service_execute_expected,caller_count,policy_reference_count,evidence
) values
('atlas.project_pull_options_for_member_v1(uuid,uuid,date,integer)','app_endpoint','verified','active',true,true,true,0,0,jsonb_build_object('feature','project_pull_pool_v1','schema','atlas')),
('atlas.pull_project_item_to_today_v1(uuid,uuid,date,text)','app_endpoint','verified','active',true,true,true,0,0,jsonb_build_object('feature','project_pull_pool_v1','schema','atlas')),
('atlas.return_project_item_to_pool_v1(uuid,text)','app_endpoint','verified','active',true,true,true,0,0,jsonb_build_object('feature','project_pull_pool_v1','schema','atlas'))
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  evidence=coalesce(atlas.authenticated_rpc_registry.evidence,'{}'::jsonb)||excluded.evidence,
  reviewed_at=now();
