create or replace function atlas.project_pull_options_for_member_v2(p_project_id uuid, p_membership_id uuid, p_day date default null, p_limit integer default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_day date := coalesce(p_day,(now() at time zone 'America/Chicago')::date);
  v_base jsonb;
  v_mode text := 'normal';
  v_remaining integer := 0;
  v_routing text := 'ready';
  v_options jsonb := '[]'::jsonb;
begin
  v_base := atlas.project_pull_options_for_member_v1(p_project_id,p_membership_id,v_day,p_limit);

  select coalesce(state.mode,'normal'), coalesce(state.recovery_moves_remaining,0), coalesce(state.routing_mode,'ready')
    into v_mode,v_remaining,v_routing
  from atlas.worker_day_states state
  where state.worker_membership_id=p_membership_id and state.work_date=v_day;

  v_mode := coalesce(v_mode,'normal');
  v_remaining := coalesce(v_remaining,0);
  v_routing := coalesce(v_routing,'ready');

  select coalesce(jsonb_agg(r.payload order by r.fit_rank,r.state_rank,r.priority_rank,r.activation_rank,r.ambiguity_rank,r.setup_rank,r.physical_rank,r.clarity_rank,r.minutes_rank,r.title),'[]'::jsonb)
    into v_options
  from (
    select option->>'title' as title,
      case when coalesce((option->>'fitsToday')::boolean,false) then 0 else 1 end as fit_rank,
      case
        when v_mode='recovery' and v_remaining>0 then
          case when coalesce(item.activation_demand,'medium')='low' and coalesce(item.ambiguity_load,'medium')='low' and coalesce(item.setup_load,'medium')='low' then 0 else 1 end
        when v_routing='make_simple' then case when coalesce(item.activation_demand,'medium')='low' and coalesce(item.completion_clarity,'medium')='high' then 0 else 1 end
        when v_routing='keep_moving' then case when coalesce(item.ambiguity_load,'medium')='low' and coalesce(item.completion_clarity,'medium')='high' then 0 else 1 end
        when v_routing='light_physical' then case when item.physical_load='light' then 0 when item.physical_load='moderate' then 1 else 2 end
        else 0
      end as state_rank,
      case item.priority when 'critical' then 0 when 'urgent' then 0 when 'high' then 1 when 'low' then 3 else 2 end as priority_rank,
      case coalesce(item.activation_demand,'medium') when 'low' then 0 when 'medium' then 1 else 2 end as activation_rank,
      case coalesce(item.ambiguity_load,'medium') when 'low' then 0 when 'medium' then 1 else 2 end as ambiguity_rank,
      case coalesce(item.setup_load,'medium') when 'low' then 0 when 'medium' then 1 else 2 end as setup_rank,
      case item.physical_load when 'light' then 0 when 'moderate' then 1 else 2 end as physical_rank,
      case coalesce(item.completion_clarity,'medium') when 'high' then 0 when 'medium' then 1 else 2 end as clarity_rank,
      item.expected_active_minutes as minutes_rank,
      option || jsonb_build_object(
        'activationDemand',coalesce(item.activation_demand,'medium'),
        'ambiguityLoad',coalesce(item.ambiguity_load,'medium'),
        'setupLoad',coalesce(item.setup_load,'medium'),
        'completionClarity',coalesce(item.completion_clarity,'medium'),
        'familiarity',coalesce(item.familiarity,'medium'),
        'canFragment',item.can_fragment,
        'recoveryPreferred',coalesce(item.activation_demand,'medium')='low'
          and coalesce(item.ambiguity_load,'medium')='low'
          and coalesce(item.setup_load,'medium')='low'
          and coalesce(item.completion_clarity,'medium')='high'
      ) as payload
    from jsonb_array_elements(coalesce(v_base->'options','[]'::jsonb)) option
    join atlas.project_pull_items item on item.id=(option->>'projectItemId')::uuid
  ) r;

  v_base := jsonb_set(v_base,'{options}',v_options,true);
  return v_base || jsonb_build_object(
    'workerMode',v_mode,
    'recoveryMovesRemaining',v_remaining,
    'routingMode',v_routing
  );
end;
$$;
