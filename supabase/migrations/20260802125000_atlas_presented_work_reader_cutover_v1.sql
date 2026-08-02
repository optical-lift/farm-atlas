begin;

create or replace function atlas.home_task_cards_for_membership_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_due_through date default null,
  p_done_date date default null
)
returns setof atlas.v_task_cards
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_role text;
  v_user_id uuid;
  v_worker_key text;
  v_day date := coalesce(p_done_date, (now() at time zone 'America/Chicago')::date);
  v_due_through date := coalesce(p_due_through, v_day + 35);
begin
  select fm.role, fm.user_id, nullif(lower(btrim(fm.worker_key)), '')
  into v_role, v_user_id, v_worker_key
  from atlas.farm_memberships fm
  where fm.id = p_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true;

  if v_role is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;
  if v_user_id is distinct from auth.uid() and not atlas.is_farm_manager_or_owner(p_farm_id) then
    raise exception 'Only farm management may read another member''s work.' using errcode = '42501';
  end if;

  return query
  with chosen as (
    select row.task_id, 0 as surface_group, row.lane_order, row.selection_rank
    from atlas.presented_work_rows_v1(p_farm_id, p_membership_id, v_day) row
    where row.presentation_state in ('attention', 'presented')

    union all

    select t.id, 1, 5, row_number() over (order by t.completed_at desc nulls last, t.created_at desc)
    from atlas.tasks t
    where t.farm_id = p_farm_id
      and t.status = 'done'
      and t.due_date = v_day
      and (
        t.assigned_membership_id = p_membership_id
        or t.assigned_user_id = v_user_id
        or t.metadata ->> 'executor_membership_id' = p_membership_id::text
        or (jsonb_typeof(t.metadata -> 'shared_with_membership_ids') = 'array'
            and (t.metadata -> 'shared_with_membership_ids') ? p_membership_id::text)
        or (v_role = 'owner' and lower(coalesce(t.metadata ->> 'owner_task', 'false')) = 'true')
      )

    union all

    select t.id, 2, 1, row_number() over (order by t.due_date, t.priority, t.created_at)
    from atlas.tasks t
    where t.farm_id = p_farm_id
      and t.status in ('open', 'blocked')
      and t.parent_task_id is null
      and t.work_lane = 'required'
      and t.commitment_kind = 'hard_date'
      and t.due_date > v_day
      and t.due_date <= v_due_through
      and (
        t.assigned_membership_id = p_membership_id
        or t.assigned_user_id = v_user_id
        or t.metadata ->> 'executor_membership_id' = p_membership_id::text
        or (jsonb_typeof(t.metadata -> 'shared_with_membership_ids') = 'array'
            and (t.metadata -> 'shared_with_membership_ids') ? p_membership_id::text)
        or (v_worker_key is not null and lower(coalesce(
              nullif(t.metadata ->> 'executor_worker_key', ''),
              nullif(t.metadata ->> 'assignee_key', ''),
              nullif(t.metadata ->> 'assigned_to', '')
            )) = v_worker_key)
        or (v_role = 'owner' and lower(coalesce(t.metadata ->> 'owner_task', 'false')) = 'true')
      )
  ), deduped as (
    select distinct on (task_id) task_id, surface_group, lane_order, selection_rank
    from chosen
    order by task_id, surface_group, lane_order, selection_rank
  )
  select card.*
  from deduped selected
  join atlas.v_task_cards card on card.task_id = selected.task_id
  where (
    (card.task_type = 'grow_room_care' and lower(card.title) in ('grow room care', 'water + check grow room', 'check grow room'))
    or not (
      coalesce(card.zone_key, '') = 'grow_room'
      or coalesce(card.zone_label, '') ilike '%grow room%'
      or coalesce(card.metadata ->> 'collection_zone', '') ilike '%grow room%'
      or coalesce(card.metadata ->> 'location_label', '') ilike '%grow room%'
      or coalesce(card.metadata ->> 'work_route', '') in ('grow_room_check','grow_room_audit','pot_up','hardening_off','soil_block','grow_room_setup','grow_room_care')
    )
  )
  order by selected.surface_group, selected.lane_order, selected.selection_rank;
end;
$function$;

create or replace function atlas.worker_task_hand_v1(
  p_farm_id uuid,
  p_for_date date default current_date,
  p_target_membership_id uuid default null
)
returns table(
  task_id uuid,
  title text,
  task_type text,
  status text,
  priority text,
  due_date date,
  instruction text,
  blocker_text text,
  zone_id uuid,
  zone_key text,
  zone_label text,
  assigned_membership_id uuid,
  visibility_scope text,
  task_lane text,
  total_steps bigint,
  completed_steps bigint,
  can_act boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_role text;
  v_current_membership_id uuid;
  v_target_membership_id uuid;
  v_can_act boolean;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  if v_role is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  v_current_membership_id := atlas.current_membership_id(p_farm_id);
  v_target_membership_id := atlas.resolve_worker_view_membership_v1(p_farm_id, p_target_membership_id);
  if v_target_membership_id is null then return; end if;
  v_can_act := v_role = 'farm_hand' and v_current_membership_id = v_target_membership_id;

  return query
  with selected as (
    select row.*
    from atlas.presented_work_rows_v1(p_farm_id, v_target_membership_id, p_for_date) row
    where row.presentation_state in ('attention', 'presented')
  )
  select
    t.id,
    t.title,
    t.task_type,
    t.status,
    t.priority,
    t.due_date,
    coalesce(nullif(btrim(t.note), ''), nullif(btrim(t.unlock_text), '')),
    nullif(btrim(t.blocker_text), ''),
    t.zone_id,
    z.stable_key,
    z.label,
    t.assigned_membership_id,
    t.visibility_scope,
    selected.presentation_reason,
    (select count(*) from atlas.tasks child where child.farm_id=t.farm_id and (child.parent_task_id=t.id or child.metadata->>'parent_task_id'=t.id::text) and child.status<>'archived'),
    (select count(*) from atlas.tasks child where child.farm_id=t.farm_id and (child.parent_task_id=t.id or child.metadata->>'parent_task_id'=t.id::text) and child.status='done'),
    v_can_act and t.visibility_scope = 'assigned_worker'
  from selected
  join atlas.tasks t on t.id = selected.task_id
  left join atlas.zones z on z.id = t.zone_id
  order by selected.lane_order, selected.selection_rank;
end;
$function$;

do $migration$
begin
  if to_regprocedure('atlas.journal_day_legacy_v1(uuid,date)') is null then
    alter function atlas.journal_day_v1(uuid, date) rename to journal_day_legacy_v1;
  end if;
end;
$migration$;

revoke execute on function atlas.journal_day_legacy_v1(uuid, date) from public, anon, authenticated;
grant execute on function atlas.journal_day_legacy_v1(uuid, date) to service_role;

create or replace function atlas.journal_day_for_membership_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_day date := coalesce(p_day, (now() at time zone 'America/Chicago')::date);
  v_legacy jsonb;
  v_carried jsonb := '[]'::jsonb;
  v_planned_open jsonb := '[]'::jsonb;
  v_planned_done jsonb := '[]'::jsonb;
  v_planned jsonb := '[]'::jsonb;
begin
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true
      and (fm.user_id=auth.uid() or atlas.is_farm_manager_or_owner(p_farm_id))
  ) then
    raise exception 'An active readable farm membership is required.' using errcode='42501';
  end if;

  v_legacy := atlas.journal_day_legacy_v1(p_farm_id, v_day);

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', t.id, 'title', t.title, 'status', t.status, 'dueDate', t.due_date,
    'taskType', t.task_type, 'workClass', t.work_class, 'priority', t.priority, 'zoneId', t.zone_id
  ) order by row.lane_order, row.selection_rank), '[]'::jsonb)
  into v_carried
  from atlas.presented_work_rows_v1(p_farm_id, p_membership_id, v_day) row
  join atlas.tasks t on t.id=row.task_id
  where row.presentation_state in ('attention','presented')
    and t.status in ('open','blocked')
    and t.due_date < v_day;

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', t.id, 'title', t.title, 'status', t.status, 'dueDate', t.due_date,
    'taskType', t.task_type, 'workClass', t.work_class, 'priority', t.priority, 'zoneId', t.zone_id
  ) order by row.lane_order, row.selection_rank), '[]'::jsonb)
  into v_planned_open
  from atlas.presented_work_rows_v1(p_farm_id, p_membership_id, v_day) row
  join atlas.tasks t on t.id=row.task_id
  where row.presentation_state in ('attention','presented')
    and t.status in ('open','blocked')
    and (t.due_date = v_day or t.due_date is null);

  select coalesce(jsonb_agg(value), '[]'::jsonb)
  into v_planned_done
  from jsonb_array_elements(coalesce(v_legacy->'planned', '[]'::jsonb)) value
  where value->>'status' = 'done';

  v_planned := v_planned_open || v_planned_done;

  return v_legacy || jsonb_build_object(
    'presentationContract', 'presented_work_v1',
    'carried', v_carried,
    'planned', v_planned,
    'summary', coalesce(v_legacy->'summary', '{}'::jsonb) || jsonb_build_object(
      'open', jsonb_array_length(v_carried) + jsonb_array_length(v_planned_open),
      'done', jsonb_array_length(v_planned_done)
    )
  );
end;
$function$;

create or replace function atlas.journal_day_v1(p_farm_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_membership_id uuid;
begin
  v_membership_id := atlas.current_membership_id(p_farm_id);
  if v_membership_id is null then
    raise exception 'An active farm membership is required.' using errcode='42501';
  end if;
  return atlas.journal_day_for_membership_v1(p_farm_id, v_membership_id, p_day);
end;
$function$;

revoke execute on function atlas.journal_day_for_membership_v1(uuid, uuid, date) from public, anon;
grant execute on function atlas.journal_day_for_membership_v1(uuid, uuid, date) to authenticated, service_role;
revoke execute on function atlas.journal_day_v1(uuid, date) from public, anon;
grant execute on function atlas.journal_day_v1(uuid, date) to authenticated, service_role;

commit;
