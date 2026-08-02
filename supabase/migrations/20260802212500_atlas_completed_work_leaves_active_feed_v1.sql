begin;

-- The Home feed is an execution surface, not a completion ledger. Completed work
-- remains recorded on atlas.tasks and in Journal events, but it must leave the
-- active feed immediately.
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

    -- Future hard-date obligations are a preview. They must still be active,
    -- top-level work; legacy child metadata is excluded as well as the canonical
    -- parent_task_id relationship.
    select t.id, 1, 1, row_number() over (order by t.due_date, t.priority, t.created_at)
    from atlas.tasks t
    where t.farm_id = p_farm_id
      and t.status in ('open', 'blocked')
      and t.parent_task_id is null
      and nullif(t.metadata ->> 'parent_task_id', '') is null
      and nullif(t.metadata ->> 'parentTaskId', '') is null
      and lower(coalesce(t.metadata ->> 'is_child_task', 'false')) <> 'true'
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
  where card.status in ('open', 'blocked')
    and (
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

-- Living Day keeps the completed count for the day, but completed task cards no
-- longer remain inside journal.planned. Their durable history remains in task
-- completion columns and Journal events.
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
  v_completed_today_count integer := 0;
begin
  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id = p_membership_id
      and fm.farm_id = p_farm_id
      and fm.active = true
      and (fm.user_id = auth.uid() or atlas.is_farm_manager_or_owner(p_farm_id))
  ) then
    raise exception 'An active readable farm membership is required.' using errcode = '42501';
  end if;

  v_legacy := atlas.journal_day_legacy_v1(p_farm_id, v_day);

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', t.id, 'title', t.title, 'status', t.status, 'dueDate', t.due_date,
    'taskType', t.task_type, 'workClass', t.work_class, 'priority', t.priority, 'zoneId', t.zone_id
  ) order by row.lane_order, row.selection_rank), '[]'::jsonb)
  into v_carried
  from atlas.presented_work_rows_v1(p_farm_id, p_membership_id, v_day) row
  join atlas.tasks t on t.id = row.task_id
  where row.presentation_state in ('attention', 'presented')
    and t.status in ('open', 'blocked')
    and t.due_date < v_day;

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', t.id, 'title', t.title, 'status', t.status, 'dueDate', t.due_date,
    'taskType', t.task_type, 'workClass', t.work_class, 'priority', t.priority, 'zoneId', t.zone_id
  ) order by row.lane_order, row.selection_rank), '[]'::jsonb)
  into v_planned_open
  from atlas.presented_work_rows_v1(p_farm_id, p_membership_id, v_day) row
  join atlas.tasks t on t.id = row.task_id
  where row.presentation_state in ('attention', 'presented')
    and t.status in ('open', 'blocked')
    and (t.due_date = v_day or t.due_date is null);

  select count(*)::integer
  into v_completed_today_count
  from jsonb_array_elements(coalesce(v_legacy -> 'planned', '[]'::jsonb)) value
  where value ->> 'status' = 'done';

  return v_legacy || jsonb_build_object(
    'presentationContract', 'presented_work_v1',
    'carried', v_carried,
    'planned', v_planned_open,
    'summary', coalesce(v_legacy -> 'summary', '{}'::jsonb) || jsonb_build_object(
      'open', jsonb_array_length(v_carried) + jsonb_array_length(v_planned_open),
      'done', v_completed_today_count
    )
  );
end;
$function$;

comment on function atlas.home_task_cards_for_membership_v2(uuid, uuid, date, date)
is 'Returns only active Presented Work plus active future hard-date previews. Completed tasks and child steps remain in history but leave the Home feed.';

comment on function atlas.journal_day_for_membership_v1(uuid, uuid, date)
is 'Returns active Presented Work in carried/planned and preserves completed-day counts and Journal history without keeping completed cards in the active plan.';

commit;
