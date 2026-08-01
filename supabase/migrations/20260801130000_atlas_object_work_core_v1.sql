begin;

create table if not exists atlas.object_work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete restrict,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  action_kind text not null check (action_kind in ('check','water','sow','transplant','harvest','repair','reset','prepare','deliver','other')),
  title text not null,
  instructions text,
  done_definition text not null,
  unlock_text text,
  effort_class text not null default 'standard' check (effort_class in ('light','standard','heavy')),
  assigned_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  due_date date not null,
  work_window_key text not null,
  release_local_time time not null,
  close_local_time time,
  release_mode text not null default 'put_in_work' check (release_mode in ('put_in_work','hold_for_capacity')),
  status text not null default 'planned' check (status in ('planned','released','completed','cancelled')),
  planned_occurrence_id uuid references atlas.planned_work_occurrences(id) on delete set null,
  task_id uuid references atlas.tasks(id) on delete set null,
  idempotency_key text not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  completion_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, idempotency_key)
);

create table if not exists atlas.object_work_steps (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references atlas.object_work_items(id) on delete cascade,
  position integer not null,
  title text not null,
  completed_at timestamptz,
  completed_by_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (work_item_id, position)
);

create table if not exists atlas.object_work_crop_cycles (
  work_item_id uuid not null references atlas.object_work_items(id) on delete cascade,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete cascade,
  role text not null default 'affects' check (role in ('affects','protects','harvests','observes')),
  created_at timestamptz not null default now(),
  primary key (work_item_id, crop_cycle_id, role)
);

create index if not exists object_work_items_farm_status_idx
  on atlas.object_work_items(farm_id, status, due_date);
create index if not exists object_work_items_object_status_idx
  on atlas.object_work_items(object_id, status, due_date);
create index if not exists object_work_items_assignee_status_idx
  on atlas.object_work_items(assigned_membership_id, status, due_date);
create index if not exists object_work_items_occurrence_idx
  on atlas.object_work_items(planned_occurrence_id);
create index if not exists object_work_items_task_idx
  on atlas.object_work_items(task_id, status);
create index if not exists object_work_steps_item_idx
  on atlas.object_work_steps(work_item_id, position);
create index if not exists object_work_crop_cycles_cycle_idx
  on atlas.object_work_crop_cycles(crop_cycle_id);
create unique index if not exists object_work_items_active_equivalent_idx
  on atlas.object_work_items(object_id, assigned_membership_id, due_date, action_kind, lower(title))
  where status in ('planned','released');

alter table atlas.object_work_items enable row level security;
alter table atlas.object_work_steps enable row level security;
alter table atlas.object_work_crop_cycles enable row level security;

revoke all on table atlas.object_work_items from public, anon, authenticated;
revoke all on table atlas.object_work_steps from public, anon, authenticated;
revoke all on table atlas.object_work_crop_cycles from public, anon, authenticated;
grant select, insert, update, delete on table atlas.object_work_items to service_role;
grant select, insert, update, delete on table atlas.object_work_steps to service_role;
grant select, insert, update, delete on table atlas.object_work_crop_cycles to service_role;

create or replace function atlas.object_work_action_contract_v1(p_action_kind text)
returns jsonb
language sql
immutable
set search_path = pg_catalog, atlas
as $function$
  select case lower(btrim(coalesce(p_action_kind,'')))
    when 'check' then jsonb_build_object('kind','check','label','Check','actionKey','crop_cycle','route','crop_cycle','taskType','object_check')
    when 'water' then jsonb_build_object('kind','water','label','Water','actionKey','water','route','water','taskType','object_water')
    when 'sow' then jsonb_build_object('kind','sow','label','Sow','actionKey','seed','route','seed','taskType','object_sow')
    when 'transplant' then jsonb_build_object('kind','transplant','label','Transplant','actionKey','plant','route','plant','taskType','object_transplant')
    when 'harvest' then jsonb_build_object('kind','harvest','label','Harvest','actionKey','harvest','route','harvest','taskType','object_harvest')
    when 'repair' then jsonb_build_object('kind','repair','label','Repair','actionKey','build','route','build','taskType','object_repair')
    when 'reset' then jsonb_build_object('kind','reset','label','Reset','actionKey','build','route','build','taskType','object_reset')
    when 'prepare' then jsonb_build_object('kind','prepare','label','Prepare','actionKey','build','route','build','taskType','object_prepare')
    when 'deliver' then jsonb_build_object('kind','deliver','label','Deliver','actionKey','venue','route','venue','taskType','object_delivery')
    when 'other' then jsonb_build_object('kind','other','label','Do','actionKey','venue','route','venue','taskType','object_work')
    else null
  end
$function$;

create or replace function atlas.object_work_item_json_v1(p_work_item_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
  select jsonb_build_object(
    'id', item.id,
    'actionKind', item.action_kind,
    'actionLabel', atlas.object_work_action_contract_v1(item.action_kind) ->> 'label',
    'title', item.title,
    'instructions', item.instructions,
    'doneDefinition', item.done_definition,
    'unlockText', item.unlock_text,
    'effortClass', item.effort_class,
    'dueDate', item.due_date,
    'workWindowKey', item.work_window_key,
    'releaseLocalTime', item.release_local_time,
    'closeLocalTime', item.close_local_time,
    'releaseMode', item.release_mode,
    'status', item.status,
    'plannedOccurrenceId', item.planned_occurrence_id,
    'taskId', item.task_id,
    'assignee', jsonb_build_object(
      'membershipId', membership.id,
      'role', membership.role,
      'workerKey', membership.worker_key,
      'displayName', coalesce(profile.display_name, membership.worker_key, initcap(membership.role))
    ),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', step.id,
        'position', step.position,
        'title', step.title,
        'complete', step.completed_at is not null,
        'completedAt', step.completed_at
      ) order by step.position)
      from atlas.object_work_steps step
      where step.work_item_id = item.id
    ), '[]'::jsonb),
    'cropCycles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cycle.id,
        'label', cycle.crop_label,
        'variety', cycle.variety,
        'state', cycle.cycle_state,
        'role', link.role
      ) order by cycle.crop_label, cycle.variety nulls last)
      from atlas.object_work_crop_cycles link
      join atlas.crop_cycles cycle on cycle.id = link.crop_cycle_id
      where link.work_item_id = item.id
    ), '[]'::jsonb),
    'object', jsonb_build_object(
      'id', object_row.id,
      'key', object_row.stable_key,
      'label', object_row.label,
      'type', object_row.object_type
    ),
    'createdAt', item.created_at,
    'completedAt', item.completed_at,
    'metadata', item.metadata
  )
  from atlas.object_work_items item
  join atlas.growing_objects object_row on object_row.id = item.object_id
  join atlas.farm_memberships membership on membership.id = item.assigned_membership_id
  left join atlas.user_profiles profile on profile.user_id = membership.user_id
  where item.id = p_work_item_id
$function$;

create or replace function atlas.object_work_context_v1(
  p_farm_id uuid,
  p_object_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_role text;
  v_membership_id uuid;
  v_object atlas.growing_objects%rowtype;
  v_settings atlas.farm_task_release_settings%rowtype;
  v_active_top integer;
  v_active_assignee_max integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  v_role := atlas.current_farm_role(p_farm_id);
  v_membership_id := atlas.current_membership_id(p_farm_id);
  if v_role is null or v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  select object_row.* into v_object
  from atlas.growing_objects object_row
  where object_row.farm_id = p_farm_id and object_row.stable_key = btrim(p_object_key)
  limit 1;
  if v_object.id is null then
    raise exception 'Growing object not found.' using errcode = 'P0002';
  end if;

  select * into v_settings from atlas.farm_task_release_settings where farm_id = p_farm_id;

  select count(*)::integer into v_active_top
  from atlas.tasks task
  where task.farm_id = p_farm_id
    and task.status in ('open','blocked')
    and task.parent_task_id is null;

  select coalesce(max(member_count),0)::integer into v_active_assignee_max
  from (
    select count(*)::integer as member_count
    from atlas.tasks task
    where task.farm_id = p_farm_id
      and task.status in ('open','blocked')
      and task.assigned_membership_id is not null
    group by task.assigned_membership_id
  ) counts;

  return jsonb_build_object(
    'object', jsonb_build_object(
      'id', v_object.id,
      'key', v_object.stable_key,
      'label', v_object.label,
      'type', v_object.object_type
    ),
    'viewerRole', v_role,
    'viewerMembershipId', v_membership_id,
    'canAuthor', v_role in ('owner','manager'),
    'capacity', jsonb_build_object(
      'activeTopLevel', v_active_top,
      'maximumTopLevel', coalesce(v_settings.maximum_active_top_level_tasks,150),
      'highestMemberActive', v_active_assignee_max,
      'maximumPerMember', coalesce(v_settings.maximum_active_tasks_per_member,60),
      'farmAtCapacity', v_active_top >= coalesce(v_settings.maximum_active_top_level_tasks,150)
    ),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membershipId', membership.id,
        'role', membership.role,
        'workerKey', membership.worker_key,
        'displayName', coalesce(profile.display_name, membership.worker_key, initcap(membership.role)),
        'activeTaskCount', (
          select count(*)::integer from atlas.tasks task
          where task.assigned_membership_id = membership.id and task.status in ('open','blocked')
        )
      ) order by case membership.role when 'owner' then 0 when 'manager' then 1 else 2 end, coalesce(profile.display_name, membership.worker_key))
      from atlas.farm_memberships membership
      left join atlas.user_profiles profile on profile.user_id = membership.user_id
      where membership.farm_id = p_farm_id and membership.active
    ), '[]'::jsonb),
    'workItems', coalesce((
      select jsonb_agg(atlas.object_work_item_json_v1(item.id) order by item.due_date, item.created_at)
      from atlas.object_work_items item
      where item.object_id = v_object.id and item.status in ('planned','released')
    ), '[]'::jsonb)
  );
end;
$function$;

commit;
