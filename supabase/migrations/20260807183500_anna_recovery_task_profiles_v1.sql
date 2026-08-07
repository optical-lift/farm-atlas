begin;

-- Recovery routing is about activation burden, not merely minutes. Profile the existing
-- Elm Finish + Renovation pool so Atlas has owner-defined facts to rank from.
with anna as (
  select fm.id
  from atlas.farm_memberships fm
  join atlas.farms f on f.id=fm.farm_id
  where fm.worker_key='anna' and fm.active and lower(f.name)='elm farm'
  limit 1
)
update atlas.project_pull_items item
set activation_demand = case
      when item.title in ('Clean Garage Upright Freezer','Razor blade between the Lounge floorboards and vacuum') then 'low'
      when item.title like 'Anna — Hang Cafe Lights%' then 'medium'
      when item.title like 'Buy %' then 'medium'
      when item.title in ('Paint Kitchen Ceiling — Single Coat','Prepare Farm Work Area in Basement') then 'high'
      when item.title like 'Paint 2 Exterior House Doors Purple%' then 'high'
      when item.title in ('Clean Exterior Windows + Glass Doors','Clean Interior Windows + Glass Doors') then 'high'
      else 'medium'
    end,
    ambiguity_load = case
      when item.title in (
        'Clean Garage Upright Freezer','Razor blade between the Lounge floorboards and vacuum',
        'Clean Lounge chairs with upholstery cleaner','Gently Pressure Wash Back Porch',
        'Paint Kitchen Ceiling — Single Coat','Apply Polyurethane to Upper Kitchen Cabinets'
      ) then 'low'
      when item.title='Prepare Farm Work Area in Basement' then 'high'
      else 'medium'
    end,
    setup_load = case
      when item.title in ('Razor blade between the Lounge floorboards and vacuum','Clean Garage Upright Freezer') then 'low'
      when item.title in ('Paint Kitchen Ceiling — Single Coat','Apply Polyurethane to Upper Kitchen Cabinets') then 'high'
      when item.title='Prepare Farm Work Area in Basement' then 'high'
      else 'medium'
    end,
    completion_clarity = case
      when item.title='Prepare Farm Work Area in Basement' then 'low'
      else 'high'
    end,
    familiarity = case
      when item.title like 'Buy %' then 'medium'
      when item.title like 'Install %' then 'medium'
      else 'high'
    end,
    can_fragment = case
      when item.expected_active_minutes >= 90
        or item.title in ('Prepare Farm Work Area in Basement','Clean Exterior Windows + Glass Doors') then true
      else item.can_fragment
    end,
    metadata = coalesce(item.metadata,'{}'::jsonb) || jsonb_build_object(
      'recovery_profile_source','owner_reviewed_finish_pool_v1',
      'recovery_profiled_at',now()
    ),
    updated_at=now()
from anna
where item.preferred_membership_id=anna.id
  and item.status in ('available','selected');

create or replace function atlas.project_pull_options_for_member_v2(
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
  v_base jsonb;
  v_mode text := 'normal';
  v_remaining integer := 0;
  v_options jsonb := '[]'::jsonb;
begin
  v_base := atlas.project_pull_options_for_member_v1(p_project_id,p_membership_id,v_day,p_limit);

  select state.mode,state.recovery_moves_remaining
  into v_mode,v_remaining
  from atlas.worker_day_states state
  where state.worker_membership_id=p_membership_id and state.work_date=v_day;

  v_mode := coalesce(v_mode,'normal');
  v_remaining := coalesce(v_remaining,0);

  if v_mode='recovery' and v_remaining>0 then
    select coalesce(jsonb_agg(
      option_row.payload
      order by
        option_row.fit_rank,
        option_row.activation_rank,
        option_row.ambiguity_rank,
        option_row.setup_rank,
        option_row.clarity_rank,
        option_row.physical_rank,
        option_row.minutes_rank,
        option_row.priority_rank,
        option_row.title
    ),'[]'::jsonb)
    into v_options
    from (
      select
        option ->> 'title' as title,
        case when coalesce((option ->> 'fitsToday')::boolean,false) then 0 else 1 end as fit_rank,
        case coalesce(item.activation_demand,'medium') when 'low' then 0 when 'medium' then 1 else 2 end as activation_rank,
        case coalesce(item.ambiguity_load,'medium') when 'low' then 0 when 'medium' then 1 else 2 end as ambiguity_rank,
        case coalesce(item.setup_load,'medium') when 'low' then 0 when 'medium' then 1 else 2 end as setup_rank,
        case coalesce(item.completion_clarity,'medium') when 'high' then 0 when 'medium' then 1 else 2 end as clarity_rank,
        case item.physical_load when 'light' then 0 when 'moderate' then 1 else 2 end as physical_rank,
        item.expected_active_minutes as minutes_rank,
        case item.priority when 'critical' then 0 when 'urgent' then 0 when 'high' then 1 when 'low' then 3 else 2 end as priority_rank,
        option || jsonb_build_object(
          'activationDemand',coalesce(item.activation_demand,'medium'),
          'ambiguityLoad',coalesce(item.ambiguity_load,'medium'),
          'setupLoad',coalesce(item.setup_load,'medium'),
          'completionClarity',coalesce(item.completion_clarity,'medium'),
          'familiarity',coalesce(item.familiarity,'medium'),
          'canFragment',item.can_fragment,
          'recoveryPreferred',
            coalesce(item.activation_demand,'medium')='low'
            and coalesce(item.ambiguity_load,'medium')='low'
            and coalesce(item.setup_load,'medium')='low'
            and coalesce(item.completion_clarity,'medium')='high'
        ) as payload
      from jsonb_array_elements(coalesce(v_base->'options','[]'::jsonb)) option
      join atlas.project_pull_items item on item.id=(option->>'projectItemId')::uuid
    ) option_row;

    v_base := jsonb_set(v_base,'{options}',v_options,true);
  end if;

  return v_base || jsonb_build_object('workerMode',v_mode,'recoveryMovesRemaining',v_remaining);
end;
$function$;

commit;
