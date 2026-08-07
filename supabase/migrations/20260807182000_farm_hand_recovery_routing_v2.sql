begin;

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
  where state.worker_membership_id=p_membership_id
    and state.work_date=v_day;

  v_mode := coalesce(v_mode,'normal');
  v_remaining := coalesce(v_remaining,0);

  if v_mode='recovery' and v_remaining>0 then
    select coalesce(jsonb_agg(
      option_row.payload
      order by
        option_row.fit_rank,
        option_row.physical_rank,
        option_row.activation_rank,
        option_row.ambiguity_rank,
        option_row.setup_rank,
        option_row.clarity_rank,
        option_row.minutes_rank,
        option_row.priority_rank,
        option_row.title
    ),'[]'::jsonb)
    into v_options
    from (
      select
        option ->> 'title' as title,
        case when coalesce((option ->> 'fitsToday')::boolean,false) then 0 else 1 end as fit_rank,
        case item.physical_load when 'light' then 0 when 'moderate' then 1 else 2 end as physical_rank,
        case coalesce(item.activation_demand,'medium') when 'low' then 0 when 'medium' then 1 else 2 end as activation_rank,
        case coalesce(item.ambiguity_load,'medium') when 'low' then 0 when 'medium' then 1 else 2 end as ambiguity_rank,
        case coalesce(item.setup_load,'medium') when 'low' then 0 when 'medium' then 1 else 2 end as setup_rank,
        case coalesce(item.completion_clarity,'medium') when 'high' then 0 when 'medium' then 1 else 2 end as clarity_rank,
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
            item.physical_load='light'
            and coalesce(item.activation_demand,'medium')='low'
            and coalesce(item.ambiguity_load,'medium')='low'
            and coalesce(item.setup_load,'medium')='low'
            and coalesce(item.completion_clarity,'medium')='high'
        ) as payload
      from jsonb_array_elements(coalesce(v_base->'options','[]'::jsonb)) option
      join atlas.project_pull_items item
        on item.id=(option->>'projectItemId')::uuid
    ) option_row;

    v_base := jsonb_set(v_base,'{options}',v_options,true);
  end if;

  return v_base || jsonb_build_object(
    'workerMode',v_mode,
    'recoveryMovesRemaining',v_remaining
  );
end;
$function$;

create or replace function atlas.report_worker_needs_lighter_work_v2(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_result jsonb;
  v_local_date date := timezone('America/Chicago',now())::date;
  v_set_aside jsonb;
begin
  v_result := atlas.report_worker_needs_lighter_work_v1(p_task_id);

  v_set_aside := atlas.set_task_aside_today_v2(
    p_task_id,
    v_local_date + 1,
    'lighter-work:' || p_task_id::text || ':' || v_local_date::text
  );

  return v_result || jsonb_build_object(
    'setAsideToday',true,
    'returnsOn',v_set_aside->>'returnsOn'
  );
end;
$$;

revoke all on function atlas.project_pull_options_for_member_v2(uuid,uuid,date,integer) from public,anon,authenticated;
revoke all on function atlas.report_worker_needs_lighter_work_v2(uuid) from public,anon,authenticated;
grant execute on function atlas.project_pull_options_for_member_v2(uuid,uuid,date,integer) to authenticated,service_role;
grant execute on function atlas.report_worker_needs_lighter_work_v2(uuid) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,
  security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values
(
  'atlas.project_pull_options_for_member_v2(uuid,uuid,date,integer)',
  'app_endpoint','verified','active',true,true,true,1,2,
  jsonb_build_object(
    'source','farm_hand_recovery_routing_v2',
    'call_site','Farm Hand Conveyor project-pull selector',
    'authorization','inherits project pull v1 membership and owner authorization; recovery state only reorders eligible work',
    'reviewed_date','2026-08-07'
  ),now(),now()
),
(
  'atlas.report_worker_needs_lighter_work_v2(uuid)',
  'app_endpoint','verified','active',true,true,true,1,3,
  jsonb_build_object(
    'source','farm_hand_recovery_routing_v2',
    'call_site','Farm Hand Conveyor Need lighter work action',
    'authorization','signed-in farm hand may report only their own assigned task; task is hidden from the remainder of today without changing due date',
    'reviewed_date','2026-08-07'
  ),now(),now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=coalesce(atlas.authenticated_rpc_registry.evidence,'{}'::jsonb)||excluded.evidence,
    reviewed_at=excluded.reviewed_at;

commit;
