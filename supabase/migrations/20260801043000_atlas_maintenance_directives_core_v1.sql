begin;

create table if not exists atlas.maintenance_directives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete restrict,
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  maintenance_kind text not null check (maintenance_kind in ('weed','mow')),
  weed_card_id uuid references atlas.weed_cards(id) on delete cascade,
  rhythm_state_id uuid references atlas.rhythm_state(id) on delete cascade,
  directive_kind text not null default 'instruction' check (directive_kind in ('instruction','prerequisite')),
  title text not null,
  instructions text,
  effect_policy text not null check (effect_policy in ('bring_forward_only','target_condition','full_maintenance','inspection_only')),
  target_condition text,
  assigned_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  due_date date not null,
  work_window_key text not null,
  release_local_time time not null,
  close_local_time time,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  serving_task_id uuid references atlas.tasks(id) on delete set null,
  prerequisite_task_id uuid references atlas.tasks(id) on delete set null,
  original_task_due_date date,
  idempotency_key text not null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  completed_by_user_id uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  completion_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, idempotency_key),
  check (
    (maintenance_kind = 'weed' and weed_card_id is not null and rhythm_state_id is null)
    or (maintenance_kind = 'mow' and rhythm_state_id is not null and weed_card_id is null)
  ),
  check (
    (directive_kind = 'instruction' and prerequisite_task_id is null)
    or (directive_kind = 'prerequisite' and prerequisite_task_id is not null)
  ),
  check (
    target_condition is null
    or target_condition in ('heavy','medium_pressure','row_readable','mostly_clear','clear','mowed_full','acceptable_no_cut')
  )
);

create table if not exists atlas.maintenance_directive_steps (
  id uuid primary key default gen_random_uuid(),
  directive_id uuid not null references atlas.maintenance_directives(id) on delete cascade,
  position integer not null,
  title text not null,
  completed_at timestamptz,
  completed_by_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (directive_id, position)
);

create table if not exists atlas.maintenance_directive_crop_cycles (
  directive_id uuid not null references atlas.maintenance_directives(id) on delete cascade,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete cascade,
  role text not null default 'affects' check (role in ('affects','prerequisite','observes','preserves')),
  created_at timestamptz not null default now(),
  primary key (directive_id, crop_cycle_id, role)
);

create index if not exists maintenance_directives_farm_status_idx
  on atlas.maintenance_directives(farm_id, status, due_date);
create index if not exists maintenance_directives_object_status_idx
  on atlas.maintenance_directives(object_id, status, due_date);
create index if not exists maintenance_directives_serving_task_idx
  on atlas.maintenance_directives(serving_task_id, status);
create index if not exists maintenance_directives_prerequisite_task_idx
  on atlas.maintenance_directives(prerequisite_task_id, status);
create index if not exists maintenance_directives_assignee_idx
  on atlas.maintenance_directives(assigned_membership_id, status, due_date);
create index if not exists maintenance_directives_weed_card_idx
  on atlas.maintenance_directives(weed_card_id, status);
create index if not exists maintenance_directives_rhythm_state_idx
  on atlas.maintenance_directives(rhythm_state_id, status);
create index if not exists maintenance_directive_steps_directive_idx
  on atlas.maintenance_directive_steps(directive_id, position);
create index if not exists maintenance_directive_crop_cycles_cycle_idx
  on atlas.maintenance_directive_crop_cycles(crop_cycle_id);

alter table atlas.maintenance_directives enable row level security;
alter table atlas.maintenance_directive_steps enable row level security;
alter table atlas.maintenance_directive_crop_cycles enable row level security;

revoke all on table atlas.maintenance_directives from public, anon, authenticated;
revoke all on table atlas.maintenance_directive_steps from public, anon, authenticated;
revoke all on table atlas.maintenance_directive_crop_cycles from public, anon, authenticated;
grant select, insert, update, delete on table atlas.maintenance_directives to service_role;
grant select, insert, update, delete on table atlas.maintenance_directive_steps to service_role;
grant select, insert, update, delete on table atlas.maintenance_directive_crop_cycles to service_role;

create or replace function atlas.maintenance_directive_window_v1(p_window_key text)
returns jsonb
language sql
immutable
set search_path = pg_catalog, atlas
as $function$
  select case lower(btrim(coalesce(p_window_key, '')))
    when 'first_thing' then jsonb_build_object('key','first_thing','label','First thing','release','06:30','close','09:00')
    when 'morning' then jsonb_build_object('key','morning','label','Morning','release','08:00','close','11:30')
    when 'midday' then jsonb_build_object('key','midday','label','Midday','release','11:30','close','14:30')
    when 'afternoon' then jsonb_build_object('key','afternoon','label','Afternoon','release','15:00','close','18:00')
    when 'evening' then jsonb_build_object('key','evening','label','Evening','release','19:00','close','20:30')
    else null
  end
$function$;

create or replace function atlas.maintenance_directive_json_v1(p_directive_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
  select jsonb_build_object(
    'id', directive.id,
    'maintenanceKind', directive.maintenance_kind,
    'directiveKind', directive.directive_kind,
    'title', directive.title,
    'instructions', directive.instructions,
    'effectPolicy', directive.effect_policy,
    'targetCondition', directive.target_condition,
    'dueDate', directive.due_date,
    'workWindowKey', directive.work_window_key,
    'releaseLocalTime', directive.release_local_time,
    'closeLocalTime', directive.close_local_time,
    'status', directive.status,
    'servingTaskId', directive.serving_task_id,
    'prerequisiteTaskId', directive.prerequisite_task_id,
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
      from atlas.maintenance_directive_steps step
      where step.directive_id = directive.id
    ), '[]'::jsonb),
    'cropCycles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cycle.id,
        'label', cycle.crop_label,
        'variety', cycle.variety,
        'state', cycle.cycle_state,
        'role', link.role
      ) order by cycle.crop_label, cycle.variety nulls last)
      from atlas.maintenance_directive_crop_cycles link
      join atlas.crop_cycles cycle on cycle.id = link.crop_cycle_id
      where link.directive_id = directive.id
    ), '[]'::jsonb),
    'createdAt', directive.created_at,
    'completedAt', directive.completed_at
  )
  from atlas.maintenance_directives directive
  join atlas.farm_memberships membership on membership.id = directive.assigned_membership_id
  left join atlas.user_profiles profile on profile.user_id = membership.user_id
  where directive.id = p_directive_id
$function$;

create or replace function atlas.maintenance_directive_context_v1(
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
  v_weed_card atlas.weed_cards%rowtype;
  v_mowing_state atlas.rhythm_state%rowtype;
  v_weed_task_id uuid;
  v_mow_task_id uuid;
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
  where object_row.farm_id = p_farm_id
    and object_row.stable_key = btrim(p_object_key)
  limit 1;

  if v_object.id is null then
    raise exception 'Growing object not found.' using errcode = 'P0002';
  end if;

  select card.* into v_weed_card
  from atlas.weed_cards card
  where card.object_id = v_object.id
  limit 1;

  if v_weed_card.id is not null then
    select task.id into v_weed_task_id
    from atlas.tasks task
    join atlas.task_objects object_link on object_link.task_id = task.id and object_link.object_id = v_object.id
    where task.farm_id = p_farm_id
      and task.status in ('open','blocked')
      and (
        task.action_key = 'weed'
        or task.task_type = 'maintenance'
        or task.metadata ->> 'weed_card_id' = v_weed_card.id::text
      )
    order by task.due_date nulls last, task.created_at
    limit 1;
  end if;

  select state.* into v_mowing_state
  from atlas.rhythm_state state
  where state.farm_id = p_farm_id
    and state.rhythm_key = 'mowing'
    and state.subject_kind = 'growing_object'
    and state.subject_id = v_object.id
  order by state.updated_at desc
  limit 1;

  if v_mowing_state.id is not null then
    select task.id into v_mow_task_id
    from atlas.tasks task
    where task.id = v_mowing_state.current_task_id
      and task.status in ('open','blocked');
  end if;

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
    'capabilities', jsonb_build_object(
      'weed', v_object.object_type not in ('room','building','structure'),
      'mow', v_mowing_state.id is not null
    ),
    'cards', jsonb_strip_nulls(jsonb_build_object(
      'weed', case when v_object.object_type in ('room','building','structure') then null else jsonb_build_object(
        'cardId', v_weed_card.id,
        'currentCondition', v_weed_card.current_condition,
        'targetCondition', coalesce(v_weed_card.target_condition,'clear'),
        'servingTaskId', v_weed_task_id
      ) end,
      'mow', case when v_mowing_state.id is null then null else jsonb_build_object(
        'rhythmStateId', v_mowing_state.id,
        'state', v_mowing_state.state,
        'servingTaskId', v_mow_task_id,
        'targetCutHeightInches', nullif(v_object.metadata ->> 'target_cut_height_inches', '')
      ) end
    )),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membershipId', membership.id,
        'role', membership.role,
        'workerKey', membership.worker_key,
        'displayName', coalesce(profile.display_name, membership.worker_key, initcap(membership.role))
      ) order by case membership.role when 'owner' then 0 when 'manager' then 1 else 2 end, coalesce(profile.display_name, membership.worker_key))
      from atlas.farm_memberships membership
      left join atlas.user_profiles profile on profile.user_id = membership.user_id
      where membership.farm_id = p_farm_id and membership.active
    ), '[]'::jsonb),
    'directives', coalesce((
      select jsonb_agg(atlas.maintenance_directive_json_v1(directive.id) order by directive.due_date, directive.created_at)
      from atlas.maintenance_directives directive
      where directive.object_id = v_object.id
        and directive.status = 'active'
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function atlas.maintenance_directives_for_task_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
begin
  if auth.uid() is null or not atlas.can_read_task_in_journal_v1(p_task_id) then
    raise exception 'Task is not visible to the signed-in account.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(atlas.maintenance_directive_json_v1(directive.id) order by directive.due_date, directive.created_at)
    from atlas.maintenance_directives directive
    where directive.status = 'active'
      and (directive.serving_task_id = p_task_id or directive.prerequisite_task_id = p_task_id)
  ), '[]'::jsonb);
end;
$function$;

commit;
