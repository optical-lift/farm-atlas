create table if not exists atlas.owner_week_projection (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null,
  membership_id uuid not null,
  planned_date date not null,
  source_kind text not null check (source_kind in ('task','project_pull','queue','rhythm')),
  source_id uuid not null,
  title text not null,
  plan_state text not null check (plan_state in ('planned','conditional','flexible')),
  environment text,
  expected_active_minutes integer,
  reason text,
  locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, membership_id, planned_date, source_kind, source_id)
);

create index if not exists owner_week_projection_member_date_idx
  on atlas.owner_week_projection (farm_id, membership_id, planned_date);

create or replace function atlas.refresh_owner_week_projection_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_start_date date,
  p_days integer default 7
) returns integer
language plpgsql
security definer
set search_path = atlas, public
as $$
declare
  v_end date := p_start_date + greatest(p_days,1) - 1;
  v_count integer := 0;
  v_daily_minutes integer := 90;
  v_project_id uuid;
  v_date date;
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
    case when coalesce(t.metadata->>'commitment_kind','') = 'dependency' then 'conditional' else 'planned' end,
    coalesce(t.metadata->>'environment', null),
    coalesce((t.metadata->>'estimated_minutes')::int, null),
    case when coalesce(t.metadata->>'commitment_kind','') = 'dependency' then 'Dependency-gated task' else 'Dated Atlas task' end
  from atlas.tasks t
  where t.farm_id = p_farm_id
    and t.assigned_membership_id = p_membership_id
    and t.status in ('open','blocked')
    and t.due_date between p_start_date and v_end
  on conflict do nothing;

  select p.id, coalesce((p.metadata->>'daily_pull_minutes')::int,90)
    into v_project_id, v_daily_minutes
  from atlas.projects p
  where p.farm_id = p_farm_id and p.stable_key = 'elm_finish_renovation_pool'
  limit 1;

  if v_project_id is not null then
    for v_date in select generate_series(p_start_date, v_end, interval '1 day')::date loop
      if extract(isodow from v_date) = 7 then continue; end if;

      if not exists (
        select 1 from atlas.owner_week_projection o
        where o.farm_id=p_farm_id and o.membership_id=p_membership_id and o.planned_date=v_date and o.source_kind='project_pull'
      ) then
        select i.* into v_item
        from atlas.project_pull_items i
        where i.project_id = v_project_id
          and i.status = 'available'
          and (i.preferred_membership_id is null or i.preferred_membership_id = p_membership_id)
          and not exists (
            select 1 from atlas.owner_week_projection used
            where used.farm_id=p_farm_id and used.membership_id=p_membership_id
              and used.source_kind='project_pull' and used.source_id=i.id
          )
        order by
          case i.priority when 'high' then 0 when 'normal' then 1 else 2 end,
          case when i.environment='indoor' then 0 when i.environment='either' then 1 else 2 end,
          i.expected_active_minutes,
          i.title
        limit 1;

        if found then
          insert into atlas.owner_week_projection (
            farm_id,membership_id,planned_date,source_kind,source_id,title,plan_state,environment,expected_active_minutes,reason
          ) values (
            p_farm_id,p_membership_id,v_date,'project_pull',v_item.id,v_item.title,
            case when v_item.environment='outdoor' then 'flexible' else 'planned' end,
            v_item.environment,v_item.expected_active_minutes,
            case when v_item.environment='outdoor' then 'Project work; weather-sensitive' else 'Project work fitted into weekly capacity' end
          ) on conflict do nothing;
        end if;
      end if;
    end loop;
  end if;

  select count(*) into v_count
  from atlas.owner_week_projection
  where farm_id=p_farm_id and membership_id=p_membership_id and planned_date between p_start_date and v_end;

  return v_count;
end;
$$;

grant execute on function atlas.refresh_owner_week_projection_v1(uuid,uuid,date,integer) to authenticated;
