create or replace function atlas.refresh_owner_week_projection_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_start_date date,
  p_days integer default 7
)
returns integer
language plpgsql
security definer
set search_path to 'atlas', 'public'
as $function$
declare
  v_end date := p_start_date + greatest(p_days,1) - 1;
  v_count integer := 0;
  v_project_id uuid;
  v_date date;
  v_option jsonb;
  v_item record;
begin
  delete from atlas.owner_week_projection
  where farm_id = p_farm_id
    and membership_id = p_membership_id
    and planned_date between p_start_date and v_end
    and locked = false;

  insert into atlas.owner_week_projection (
    farm_id,membership_id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason
  )
  select
    t.farm_id,
    t.assigned_membership_id,
    t.due_date,
    'task',
    t.id,
    t.title,
    case
      when coalesce(t.metadata->>'commitment_kind','') = 'dependency' then 'conditional'
      else 'planned'
    end,
    coalesce(t.metadata->>'environment', null),
    coalesce((t.metadata->>'estimated_minutes')::int, null),
    case
      when coalesce(t.metadata->>'commitment_kind','') = 'dependency' then 'Dependency-gated task'
      else 'Dated Atlas task'
    end
  from atlas.tasks t
  where t.farm_id = p_farm_id
    and t.assigned_membership_id = p_membership_id
    and t.status in ('open','blocked')
    and t.due_date between p_start_date and v_end
  on conflict do nothing;

  select p.id
    into v_project_id
  from atlas.projects p
  where p.farm_id = p_farm_id
    and p.stable_key = 'elm_finish_renovation_pool'
  limit 1;

  if v_project_id is not null then
    for v_date in select generate_series(p_start_date, v_end, interval '1 day')::date loop
      if extract(isodow from v_date) = 7 then
        continue;
      end if;

      if not exists (
        select 1 from atlas.owner_week_projection o
        where o.farm_id=p_farm_id and o.membership_id=p_membership_id and o.planned_date=v_date
          and o.source_kind='project_pull'
      ) then
        v_option := null;

        select option.value
          into v_option
        from jsonb_array_elements(
          coalesce(
            atlas.project_pull_options_for_member_v2(v_project_id,p_membership_id,v_date,12)->'options',
            '[]'::jsonb
          )
        ) with ordinality as option(value, position)
        where coalesce((option.value->>'fitsToday')::boolean,false)
          and not exists (
            select 1 from atlas.owner_week_projection used
            where used.farm_id=p_farm_id and used.membership_id=p_membership_id
              and used.source_kind='project_pull'
              and used.source_id=(option.value->>'projectItemId')::uuid
          )
        order by option.position
        limit 1;

        if v_option is not null then
          select i.* into v_item
          from atlas.project_pull_items i
          where i.id=(v_option->>'projectItemId')::uuid
            and i.project_id=v_project_id
            and i.status='available';

          if found then
            insert into atlas.owner_week_projection (
              farm_id,membership_id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason
            ) values (
              p_farm_id,p_membership_id,v_date,'project_pull',v_item.id,v_item.title,
              case when v_item.environment='outdoor' then 'flexible' else 'planned' end,
              v_item.environment,v_item.expected_active_minutes,
              case
                when v_item.environment='outdoor' then 'Project work fits projected capacity; weather-sensitive'
                else 'Project work fitted into projected daily capacity'
              end
            ) on conflict do nothing;
          end if;
        end if;
      end if;
    end loop;
  end if;

  select count(*) into v_count
  from atlas.owner_week_projection
  where farm_id=p_farm_id and membership_id=p_membership_id and planned_date between p_start_date and v_end;

  return v_count;
end;
$function$;
