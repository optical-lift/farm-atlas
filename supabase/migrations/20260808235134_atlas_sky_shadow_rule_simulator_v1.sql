create or replace function atlas.shadow_sky_rule_impact_v1(
  p_farm_id uuid,
  p_operation_class text,
  p_predicate jsonb,
  p_from timestamptz default now(),
  p_days integer default 90
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_from timestamptz := coalesce(p_from,now());
  v_days integer := greatest(1,least(coalesce(p_days,90),120));
  v_until timestamptz := v_from + make_interval(days=>v_days);
  v_total_hours integer := 0;
  v_known_hours integer := 0;
  v_favored_hours integer := 0;
  v_longest_unfavored integer := 0;
  v_next_favored timestamptz;
  v_current_state jsonb;
  v_current_complete boolean := false;
  v_current_match boolean := false;
  v_task_count integer := 0;
  v_windowable_count integer := 0;
  v_protected_dated integer := 0;
  v_protected_hard integer := 0;
  v_process_count integer := 0;
  v_blocked_count integer := 0;
  v_samples jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then
    if auth.uid() is null or not atlas.is_farm_manager_or_owner(p_farm_id) then
      raise exception 'Owner or manager membership required.' using errcode='42501';
    end if;
  end if;

  if nullif(btrim(coalesce(p_operation_class,'')),'') is null then
    raise exception 'Operation class required.' using errcode='22023';
  end if;
  if jsonb_typeof(coalesce(p_predicate,'{}'::jsonb)) <> 'object' then
    raise exception 'Predicate must be a JSON object.' using errcode='22023';
  end if;

  v_current_state := atlas.sky_state_at_v2(p_farm_id,v_from);
  v_current_complete := atlas.sky_rule_state_complete_v1(p_predicate,v_current_state);
  v_current_match := v_current_complete and atlas.sky_rule_matches_v1(p_predicate,v_current_state);

  with hourly as materialized (
    select tick as at from generate_series(v_from,v_until,interval '1 hour') tick
  ), evaluated as materialized (
    select h.at, atlas.sky_state_at_v2(p_farm_id,h.at) as state from hourly h
  ), scored as materialized (
    select e.at,
           atlas.sky_rule_state_complete_v1(p_predicate,e.state) as complete,
           case when atlas.sky_rule_state_complete_v1(p_predicate,e.state)
                then atlas.sky_rule_matches_v1(p_predicate,e.state)
                else false end as matched
    from evaluated e
  ), complete_rows as (
    select s.*,
           row_number() over(order by s.at) - row_number() over(partition by s.matched order by s.at) as grp
    from scored s where s.complete
  ), runs as (
    select matched,grp,count(*)::integer as hours from complete_rows group by matched,grp
  )
  select
    (select count(*)::integer from scored),
    (select count(*)::integer from scored where complete),
    (select count(*)::integer from scored where complete and matched),
    coalesce((select max(hours) from runs where not matched),0),
    (select min(at) from scored where complete and matched and at>=v_from)
  into v_total_hours,v_known_hours,v_favored_hours,v_longest_unfavored,v_next_favored;

  select
    count(*)::integer,
    count(*) filter(where t.status='open' and t.commitment_kind='floating' and t.due_date is null)::integer,
    count(*) filter(where t.due_date is not null)::integer,
    count(*) filter(where t.commitment_kind='hard_date')::integer,
    count(*) filter(where t.work_lane='process_continuation')::integer,
    count(*) filter(where t.status='blocked')::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'taskId',t.id,
      'title',t.title,
      'status',t.status,
      'dueDate',t.due_date,
      'commitmentKind',t.commitment_kind,
      'workLane',t.work_lane,
      'wouldBeWindowable',t.status='open' and t.commitment_kind='floating' and t.due_date is null
    ) order by t.due_date nulls last,t.created_at) filter(where t.id is not null),'[]'::jsonb)
  into v_task_count,v_windowable_count,v_protected_dated,v_protected_hard,v_process_count,v_blocked_count,v_samples
  from atlas.tasks t
  where t.farm_id=p_farm_id
    and t.task_scope='farm_operation'
    and t.parent_task_id is null
    and t.status in ('open','blocked')
    and t.operation_class=p_operation_class;

  return jsonb_build_object(
    'contractVersion','shadow_sky_rule_impact_v1',
    'simulationOnly',true,
    'doesNotAffectPresentation',true,
    'farmId',p_farm_id,
    'operationClass',p_operation_class,
    'predicate',coalesce(p_predicate,'{}'::jsonb),
    'rangeStart',v_from,
    'rangeEnd',v_until,
    'days',v_days,
    'sky',jsonb_build_object(
      'sampleHours',v_total_hours,
      'knownHours',v_known_hours,
      'knownCoveragePct',case when v_total_hours=0 then 0 else round((100.0*v_known_hours/v_total_hours)::numeric,1) end,
      'favoredHours',v_favored_hours,
      'favoredCoveragePct',case when v_known_hours=0 then null else round((100.0*v_favored_hours/v_known_hours)::numeric,1) end,
      'longestUnfavoredHours',v_longest_unfavored,
      'currentStateComplete',v_current_complete,
      'currentMatch',v_current_match,
      'nextFavoredHourlySample',v_next_favored
    ),
    'inventory',jsonb_build_object(
      'openOrBlockedTasks',v_task_count,
      'windowableFloatingUndated',v_windowable_count,
      'datedTasksProtectedByGuardrail',v_protected_dated,
      'hardDateTasksProtectedByGuardrail',v_protected_hard,
      'processContinuationTasks',v_process_count,
      'blockedTasks',v_blocked_count,
      'wouldWithholdNow',case when v_current_complete and not v_current_match then v_windowable_count else 0 end,
      'tasks',v_samples
    )
  );
end;
$$;

revoke all on function atlas.shadow_sky_rule_impact_v1(uuid,text,jsonb,timestamptz,integer) from public,anon;
grant execute on function atlas.shadow_sky_rule_impact_v1(uuid,text,jsonb,timestamptz,integer) to authenticated,service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,reviewed_at
) values (
  'atlas.shadow_sky_rule_impact_v1(uuid,text,jsonb,timestamp with time zone,integer)',
  'owner_admin_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object('purpose','Simulation-only sky-rule impact reader','writes',false,'changesPresentation',false),
  now()
)
on conflict(signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;
