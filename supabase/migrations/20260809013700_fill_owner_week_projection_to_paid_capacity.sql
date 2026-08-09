-- Owner future planning should keep filling a full paid workday instead of stopping after one project pull.

create or replace function atlas.refresh_owner_week_projection_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_start_date date,
  p_days integer default 7
)
returns integer
language plpgsql security definer
set search_path to 'atlas', 'public'
as $function$
declare
  v_end date := p_start_date + greatest(p_days, 1) - 1;
  v_count integer := 0;
  v_project_id uuid;
  v_date date;
  v_option jsonb;
  v_item record;
  v_target_minutes integer := 420;
  v_heavy_cap integer := 210;
  v_paid_minutes integer := 0;
  v_heavy_minutes integer := 0;
  v_remaining integer := 0;
  v_option_minutes integer := 0;
  v_option_load text;
  v_iteration integer;
begin
  delete from atlas.owner_week_projection
  where farm_id = p_farm_id
    and membership_id = p_membership_id
    and planned_date between p_start_date and v_end
    and locked = false;

  insert into atlas.owner_week_projection (
    farm_id, membership_id, planned_date, source_kind, source_id, title,
    plan_state, environment, expected_active_minutes, reason
  )
  select
    t.farm_id,
    t.assigned_membership_id,
    t.due_date,
    'task',
    t.id,
    t.title,
    case when coalesce(t.metadata ->> 'commitment_kind', '') = 'dependency' then 'conditional' else 'planned' end,
    coalesce(t.metadata ->> 'environment', null),
    capacity.expected_active_minutes,
    case
      when coalesce((t.metadata ->> 'personal_task')::boolean, false)
        or lower(coalesce(t.metadata ->> 'paid_work', 'true')) in ('false', 'no', '0')
        then 'Personal obligation · visible, not paid-work capacity'
      when capacity.micro_round_key = 'grow_room_observation'
        then 'Micro observation · required on this date, not a work block'
      when coalesce(t.metadata ->> 'commitment_kind', '') = 'dependency'
        then 'Dependency-gated task'
      else 'Dated Atlas task'
    end
  from atlas.tasks t
  cross join lateral atlas.task_capacity_plan_v1(t, t.due_date) capacity
  where t.farm_id = p_farm_id
    and t.assigned_membership_id = p_membership_id
    and t.status in ('open', 'blocked')
    and t.due_date between p_start_date and v_end
    and t.parent_task_id is null
    and t.metadata ->> 'parent_task_id' is null
    and coalesce((t.metadata ->> 'is_child_task')::boolean, false) = false
  on conflict do nothing;

  select
    coalesce(settings.regular_target_minutes,
      case membership.role when 'farm_hand' then 420 when 'manager' then 360 else 480 end),
    coalesce(settings.heavy_minutes_soft_cap,
      case membership.role when 'farm_hand' then 210 when 'manager' then 240 else 300 end)
  into v_target_minutes, v_heavy_cap
  from atlas.farm_memberships membership
  left join atlas.member_capacity_settings settings
    on settings.membership_id = membership.id
   and settings.farm_id = membership.farm_id
   and settings.active
  where membership.id = p_membership_id
    and membership.farm_id = p_farm_id
    and membership.active;

  select p.id into v_project_id
  from atlas.projects p
  where p.farm_id = p_farm_id
    and p.stable_key = 'elm_finish_renovation_pool'
  limit 1;

  if v_project_id is not null then
    for v_date in select generate_series(p_start_date, v_end, interval '1 day')::date loop
      if extract(isodow from v_date) = 7 then
        continue;
      end if;

      select
        coalesce(sum(capacity.expected_active_minutes), 0)::integer,
        coalesce(sum(capacity.expected_active_minutes) filter(where capacity.physical_load = 'heavy'), 0)::integer
      into v_paid_minutes, v_heavy_minutes
      from atlas.tasks t
      cross join lateral atlas.task_capacity_plan_v1(t, v_date) capacity
      where t.farm_id = p_farm_id
        and t.assigned_membership_id = p_membership_id
        and t.status in ('open', 'blocked')
        and t.due_date = v_date
        and t.parent_task_id is null
        and t.metadata ->> 'parent_task_id' is null
        and coalesce((t.metadata ->> 'is_child_task')::boolean, false) = false;

      v_remaining := greatest(v_target_minutes - v_paid_minutes, 0);

      for v_iteration in 1..12 loop
        exit when v_remaining <= 0;
        v_option := null;

        select option.value into v_option
        from jsonb_array_elements(
          coalesce(
            atlas.project_pull_options_for_member_v2(v_project_id, p_membership_id, v_date, 12) -> 'options',
            '[]'::jsonb
          )
        ) with ordinality as option(value, position)
        where coalesce((option.value ->> 'fitsToday')::boolean, false)
          and coalesce((option.value ->> 'expectedActiveMinutes')::integer, 0) > 0
          and coalesce((option.value ->> 'expectedActiveMinutes')::integer, 0) <= v_remaining
          and (
            coalesce(option.value ->> 'physicalLoad', 'moderate') <> 'heavy'
            or v_heavy_minutes + coalesce((option.value ->> 'expectedActiveMinutes')::integer, 0) <= v_heavy_cap
          )
          and not exists (
            select 1
            from atlas.owner_week_projection used
            where used.farm_id = p_farm_id
              and used.membership_id = p_membership_id
              and used.source_kind = 'project_pull'
              and used.source_id = (option.value ->> 'projectItemId')::uuid
          )
        order by option.position
        limit 1;

        exit when v_option is null;
        v_option_minutes := coalesce((v_option ->> 'expectedActiveMinutes')::integer, 0);
        v_option_load := coalesce(v_option ->> 'physicalLoad', 'moderate');

        select i.* into v_item
        from atlas.project_pull_items i
        where i.id = (v_option ->> 'projectItemId')::uuid
          and i.project_id = v_project_id
          and i.status = 'available';

        exit when not found;

        insert into atlas.owner_week_projection (
          farm_id, membership_id, planned_date, source_kind, source_id, title,
          plan_state, environment, expected_active_minutes, reason
        ) values (
          p_farm_id,
          p_membership_id,
          v_date,
          'project_pull',
          v_item.id,
          v_item.title,
          case when v_item.environment = 'outdoor' then 'flexible' else 'planned' end,
          v_item.environment,
          v_item.expected_active_minutes,
          case
            when v_item.environment = 'outdoor' then 'Full-day fill · fits remaining paid capacity · weather-sensitive'
            else 'Full-day fill · fits remaining paid capacity'
          end
        ) on conflict do nothing;

        v_remaining := greatest(v_remaining - v_option_minutes, 0);
        if v_option_load = 'heavy' then
          v_heavy_minutes := v_heavy_minutes + v_option_minutes;
        end if;
      end loop;
    end loop;
  end if;

  select count(*) into v_count
  from atlas.owner_week_projection
  where farm_id = p_farm_id
    and membership_id = p_membership_id
    and planned_date between p_start_date and v_end;

  return v_count;
end;
$function$;
