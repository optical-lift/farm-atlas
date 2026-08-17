alter table atlas.owner_obligations add column stable_key text;
alter table atlas.owner_obligations add constraint owner_obligations_principal_stable_key_key unique(principal_id,stable_key);
alter table atlas.household_events add column stable_key text;
alter table atlas.household_events add constraint household_events_household_stable_key_key unique(household_id,stable_key);

create or replace function atlas.current_principal_id_v1()
returns uuid
language sql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
  select p.id from atlas.principals p
  where p.user_id=auth.uid() and p.status='active'
  limit 1
$function$;

create or replace function atlas.principal_set_capacity_policy_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_principal_id uuid;
  v_stable_key text;
  v_name text;
  v_weekdays smallint[];
  v_local_start time;
  v_local_end time;
  v_default integer;
  v_maximum integer;
  v_from date;
  v_through date;
  v_metadata jsonb;
  v_row atlas.principal_capacity_policies%rowtype;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Capacity policy input must be an object.' using errcode='22023'; end if;

  v_stable_key:=nullif(trim(p_input->>'stableKey'),'');
  v_name:=nullif(trim(p_input->>'name'),'');
  if v_stable_key is null or v_name is null then raise exception 'stableKey and name are required.' using errcode='22023'; end if;
  if jsonb_typeof(p_input->'weekdays')<>'array' then raise exception 'weekdays must be an array.' using errcode='22023'; end if;
  select coalesce(array_agg(value::smallint order by ord),array[]::smallint[])
  into v_weekdays
  from jsonb_array_elements_text(p_input->'weekdays') with ordinality e(value,ord);
  if cardinality(v_weekdays)=0 then raise exception 'At least one weekday is required.' using errcode='22023'; end if;

  v_local_start:=(p_input->>'localStart')::time;
  v_local_end:=(p_input->>'localEnd')::time;
  v_default:=(p_input->>'defaultDiscretionaryMinutes')::integer;
  v_maximum:=(p_input->>'maximumPlannedMinutes')::integer;
  v_from:=(p_input->>'effectiveFrom')::date;
  v_through:=case when nullif(p_input->>'effectiveThrough','') is null then null else (p_input->>'effectiveThrough')::date end;
  v_metadata:=case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end;

  insert into atlas.principal_capacity_policies(
    principal_id,stable_key,name,weekdays,local_start,local_end,
    default_discretionary_minutes,maximum_planned_minutes,effective_from,effective_through,active,metadata
  ) values (
    v_principal_id,v_stable_key,v_name,v_weekdays,v_local_start,v_local_end,
    v_default,v_maximum,v_from,v_through,true,v_metadata||jsonb_build_object('source','principal_set_capacity_policy_api_v1')
  )
  on conflict (principal_id,stable_key,effective_from) do update set
    name=excluded.name,weekdays=excluded.weekdays,local_start=excluded.local_start,local_end=excluded.local_end,
    default_discretionary_minutes=excluded.default_discretionary_minutes,
    maximum_planned_minutes=excluded.maximum_planned_minutes,effective_through=excluded.effective_through,
    active=true,metadata=atlas.principal_capacity_policies.metadata||excluded.metadata
  returning * into v_row;

  return jsonb_build_object(
    'contractVersion','principal_capacity_policy_authoring_v1',
    'policy',to_jsonb(v_row),
    'capacityOnEffectiveFrom',atlas.principal_capacity_day_state_v1(v_principal_id,v_from)
  );
end;
$function$;

create or replace function atlas.principal_upsert_household_rhythm_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_principal atlas.principals%rowtype;
  v_household_id uuid;
  v_stable_key text;
  v_area text;
  v_title text;
  v_expected integer;
  v_start timestamptz;
  v_end timestamptz;
  v_row atlas.household_rhythms%rowtype;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  select * into v_principal from atlas.principals p where p.user_id=auth.uid() and p.status='active' limit 1;
  if v_principal.id is null or v_principal.active_household_id is null then raise exception 'Active Principal household required.' using errcode='42501'; end if;
  v_household_id:=v_principal.active_household_id;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Household rhythm input must be an object.' using errcode='22023'; end if;

  v_stable_key:=nullif(trim(p_input->>'stableKey'),'');
  v_area:=nullif(trim(p_input->>'area'),'');
  v_title:=nullif(trim(p_input->>'title'),'');
  v_expected:=(p_input->>'expectedMinutes')::integer;
  if v_stable_key is null or v_area is null or v_title is null or v_expected<=0 then
    raise exception 'stableKey, area, title, and positive expectedMinutes are required.' using errcode='22023';
  end if;
  v_start:=case when nullif(p_input->>'nextWindowStart','') is null then null else (p_input->>'nextWindowStart')::timestamptz end;
  v_end:=case when nullif(p_input->>'nextWindowEnd','') is null then null else (p_input->>'nextWindowEnd')::timestamptz end;

  insert into atlas.household_rhythms(
    household_id,stable_key,area,title,cadence_rule,next_window_start,next_window_end,expected_minutes,
    protection_level,floor_class,interruptibility,principal_required,consequence,reason_for_floor,
    active,blocks_capacity,metadata
  ) values (
    v_household_id,v_stable_key,v_area,v_title,nullif(p_input->>'cadenceRule',''),v_start,v_end,v_expected,
    coalesce(nullif(p_input->>'protectionLevel',''),'protected'),
    coalesce(nullif(p_input->>'floorClass','')::smallint,3),
    coalesce(nullif(p_input->>'interruptibility',''),'interruptible'),
    coalesce((p_input->>'principalRequired')::boolean,true),
    nullif(p_input->>'consequence',''),
    coalesce(nullif(p_input->>'reasonForFloor',''),'Protected household rhythm.'),
    coalesce((p_input->>'active')::boolean,true),
    coalesce((p_input->>'blocksCapacity')::boolean,true),
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      ||jsonb_build_object('source','principal_upsert_household_rhythm_api_v1')
  )
  on conflict (household_id,stable_key) do update set
    area=excluded.area,title=excluded.title,cadence_rule=excluded.cadence_rule,
    next_window_start=excluded.next_window_start,next_window_end=excluded.next_window_end,
    expected_minutes=excluded.expected_minutes,protection_level=excluded.protection_level,
    floor_class=excluded.floor_class,interruptibility=excluded.interruptibility,
    principal_required=excluded.principal_required,consequence=excluded.consequence,
    reason_for_floor=excluded.reason_for_floor,active=excluded.active,blocks_capacity=excluded.blocks_capacity,
    metadata=atlas.household_rhythms.metadata||excluded.metadata
  returning * into v_row;

  return jsonb_build_object(
    'contractVersion','principal_household_rhythm_authoring_v1',
    'rhythm',to_jsonb(v_row),
    'candidate',(select to_jsonb(c) from atlas.principal_clock_candidates_v1 c where c.source_type='household_rhythm' and c.source_id=v_row.id)
  );
end;
$function$;

create or replace function atlas.principal_upsert_household_event_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_principal atlas.principals%rowtype;
  v_household_id uuid;
  v_stable_key text;
  v_title text;
  v_start timestamptz;
  v_end timestamptz;
  v_row atlas.household_events%rowtype;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  select * into v_principal from atlas.principals p where p.user_id=auth.uid() and p.status='active' limit 1;
  if v_principal.id is null or v_principal.active_household_id is null then raise exception 'Active Principal household required.' using errcode='42501'; end if;
  v_household_id:=v_principal.active_household_id;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Household event input must be an object.' using errcode='22023'; end if;

  v_stable_key:=nullif(trim(p_input->>'stableKey'),'');
  v_title:=nullif(trim(p_input->>'title'),'');
  v_start:=(p_input->>'startsAt')::timestamptz;
  v_end:=(p_input->>'endsAt')::timestamptz;
  if v_stable_key is null or v_title is null then raise exception 'stableKey and title are required.' using errcode='22023'; end if;

  insert into atlas.household_events(
    household_id,stable_key,title,event_kind,starts_at,ends_at,fixed,blocks_capacity,expected_minutes,
    protection_level,floor_class,interruptibility,principal_required,consequence,reason_for_floor,source,metadata
  ) values (
    v_household_id,v_stable_key,v_title,coalesce(nullif(p_input->>'eventKind',''),'family_commitment'),v_start,v_end,
    coalesce((p_input->>'fixed')::boolean,true),coalesce((p_input->>'blocksCapacity')::boolean,true),
    case when nullif(p_input->>'expectedMinutes','') is null then null else (p_input->>'expectedMinutes')::integer end,
    coalesce(nullif(p_input->>'protectionLevel',''),'critical'),
    coalesce(nullif(p_input->>'floorClass','')::smallint,1),
    coalesce(nullif(p_input->>'interruptibility',''),'should_not_interrupt'),
    coalesce((p_input->>'principalRequired')::boolean,true),nullif(p_input->>'consequence',''),
    coalesce(nullif(p_input->>'reasonForFloor',''),'Fixed household or family reality.'),
    coalesce(nullif(p_input->>'source',''),'principal_authoring'),
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      ||jsonb_build_object('authoringContract','principal_upsert_household_event_api_v1')
  )
  on conflict (household_id,stable_key) do update set
    title=excluded.title,event_kind=excluded.event_kind,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
    fixed=excluded.fixed,blocks_capacity=excluded.blocks_capacity,expected_minutes=excluded.expected_minutes,
    protection_level=excluded.protection_level,floor_class=excluded.floor_class,
    interruptibility=excluded.interruptibility,principal_required=excluded.principal_required,
    consequence=excluded.consequence,reason_for_floor=excluded.reason_for_floor,source=excluded.source,
    metadata=atlas.household_events.metadata||excluded.metadata
  returning * into v_row;

  return jsonb_build_object(
    'contractVersion','principal_household_event_authoring_v1',
    'event',to_jsonb(v_row),
    'candidate',(select to_jsonb(c) from atlas.principal_clock_candidates_v1 c where c.source_type='household_event' and c.source_id=v_row.id)
  );
end;
$function$;

create or replace function atlas.principal_upsert_owner_obligation_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_principal_id uuid;
  v_portfolio_unit_id uuid;
  v_stable_key text;
  v_title text;
  v_expected integer;
  v_row atlas.owner_obligations%rowtype;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Owner Obligation input must be an object.' using errcode='22023'; end if;

  v_stable_key:=nullif(trim(p_input->>'stableKey'),'');
  v_title:=nullif(trim(p_input->>'title'),'');
  v_expected:=(p_input->>'expectedMinutes')::integer;
  if v_stable_key is null or v_title is null or nullif(trim(p_input->>'domain'),'') is null or v_expected<=0 then
    raise exception 'stableKey, domain, title, and positive expectedMinutes are required.' using errcode='22023';
  end if;

  if nullif(p_input->>'portfolioUnitStableKey','') is not null then
    select u.id into v_portfolio_unit_id from atlas.portfolio_units u
    where u.owner_id=v_principal_id and u.stable_key=p_input->>'portfolioUnitStableKey' and u.archived_at is null;
    if v_portfolio_unit_id is null then raise exception 'Portfolio unit not found for this Principal.' using errcode='P0002'; end if;
  elsif nullif(p_input->>'portfolioUnitId','') is not null then
    select u.id into v_portfolio_unit_id from atlas.portfolio_units u
    where u.owner_id=v_principal_id and u.id=(p_input->>'portfolioUnitId')::uuid and u.archived_at is null;
    if v_portfolio_unit_id is null then raise exception 'Portfolio unit not found for this Principal.' using errcode='P0002'; end if;
  end if;

  insert into atlas.owner_obligations(
    principal_id,stable_key,domain,portfolio_unit_id,project_id,team_id,title,description,horizon,
    becomes_relevant_at,must_begin_by,must_finish_by,fixed_at,expires_at,preferred_window,expected_minutes,
    protection_level,floor_class,owner_capability,interruptibility,delegable,owner_required,
    consequence_of_delay,reason_for_floor,status,source,metadata
  ) values (
    v_principal_id,v_stable_key,p_input->>'domain',v_portfolio_unit_id,
    case when nullif(p_input->>'projectId','') is null then null else (p_input->>'projectId')::uuid end,
    case when nullif(p_input->>'teamId','') is null then null else (p_input->>'teamId')::uuid end,
    v_title,nullif(p_input->>'description',''),nullif(p_input->>'horizon',''),
    case when nullif(p_input->>'becomesRelevantAt','') is null then null else (p_input->>'becomesRelevantAt')::timestamptz end,
    case when nullif(p_input->>'mustBeginBy','') is null then null else (p_input->>'mustBeginBy')::timestamptz end,
    case when nullif(p_input->>'mustFinishBy','') is null then null else (p_input->>'mustFinishBy')::timestamptz end,
    case when nullif(p_input->>'fixedAt','') is null then null else (p_input->>'fixedAt')::timestamptz end,
    case when nullif(p_input->>'expiresAt','') is null then null else (p_input->>'expiresAt')::timestamptz end,
    case when nullif(p_input->>'preferredWindowStart','') is null or nullif(p_input->>'preferredWindowEnd','') is null then null
      else tstzrange((p_input->>'preferredWindowStart')::timestamptz,(p_input->>'preferredWindowEnd')::timestamptz,'[)') end,
    v_expected,p_input->>'protectionLevel',(p_input->>'floorClass')::smallint,p_input->>'ownerCapability',
    coalesce(nullif(p_input->>'interruptibility',''),'low_interruptibility'),
    coalesce((p_input->>'delegable')::boolean,false),coalesce((p_input->>'ownerRequired')::boolean,true),
    p_input->>'consequenceOfDelay',p_input->>'reasonForFloor',coalesce(nullif(p_input->>'status',''),'open'),
    coalesce(nullif(p_input->>'source',''),'principal_authoring'),
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      ||jsonb_build_object('authoringContract','principal_upsert_owner_obligation_api_v1')
  )
  on conflict (principal_id,stable_key) do update set
    domain=excluded.domain,portfolio_unit_id=excluded.portfolio_unit_id,project_id=excluded.project_id,team_id=excluded.team_id,
    title=excluded.title,description=excluded.description,horizon=excluded.horizon,
    becomes_relevant_at=excluded.becomes_relevant_at,must_begin_by=excluded.must_begin_by,must_finish_by=excluded.must_finish_by,
    fixed_at=excluded.fixed_at,expires_at=excluded.expires_at,preferred_window=excluded.preferred_window,
    expected_minutes=excluded.expected_minutes,protection_level=excluded.protection_level,floor_class=excluded.floor_class,
    owner_capability=excluded.owner_capability,interruptibility=excluded.interruptibility,delegable=excluded.delegable,
    owner_required=excluded.owner_required,consequence_of_delay=excluded.consequence_of_delay,
    reason_for_floor=excluded.reason_for_floor,status=excluded.status,source=excluded.source,
    metadata=atlas.owner_obligations.metadata||excluded.metadata
  returning * into v_row;

  return jsonb_build_object(
    'contractVersion','principal_owner_obligation_authoring_v1',
    'obligation',to_jsonb(v_row),
    'candidate',(select to_jsonb(c) from atlas.principal_clock_candidates_v1 c where c.source_type='owner_obligation' and c.source_id=v_row.id)
  );
end;
$function$;

create or replace function atlas.record_operational_escalation_v1(p_principal_id uuid,p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_portfolio_unit_id uuid;
  v_row atlas.operational_escalations%rowtype;
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Escalation input must be an object.' using errcode='22023'; end if;
  if not exists(select 1 from atlas.principals p where p.id=p_principal_id and p.status='active') then raise exception 'Active Principal required.' using errcode='P0002'; end if;
  if nullif(p_input->>'portfolioUnitStableKey','') is not null then
    select u.id into v_portfolio_unit_id from atlas.portfolio_units u where u.owner_id=p_principal_id and u.stable_key=p_input->>'portfolioUnitStableKey' and u.archived_at is null;
    if v_portfolio_unit_id is null then raise exception 'Portfolio unit not found.' using errcode='P0002'; end if;
  end if;

  insert into atlas.operational_escalations(
    principal_id,source_system,source_type,source_id,portfolio_unit_id,escalation_kind,current_state,
    threshold_crossed,consequence,owner_decision_required,options_json,severity,floor_class,
    protection_level,interruptibility,reason_for_floor,window_start,window_end,expected_owner_minutes,horizon,status,metadata
  ) values (
    p_principal_id,p_input->>'sourceSystem',p_input->>'sourceType',p_input->>'sourceId',v_portfolio_unit_id,
    p_input->>'escalationKind',coalesce(p_input->'currentState','{}'::jsonb),p_input->>'thresholdCrossed',
    p_input->>'consequence',p_input->>'ownerDecisionRequired',coalesce(p_input->'options','[]'::jsonb),
    p_input->>'severity',coalesce(nullif(p_input->>'floorClass','')::smallint,6),
    coalesce(nullif(p_input->>'protectionLevel',''),'standard'),coalesce(nullif(p_input->>'interruptibility',''),'interruptible'),
    coalesce(nullif(p_input->>'reasonForFloor',''),'Delegated operational exception crossed an explicit escalation threshold.'),
    case when nullif(p_input->>'windowStart','') is null then null else (p_input->>'windowStart')::timestamptz end,
    case when nullif(p_input->>'windowEnd','') is null then null else (p_input->>'windowEnd')::timestamptz end,
    case when nullif(p_input->>'expectedOwnerMinutes','') is null then null else (p_input->>'expectedOwnerMinutes')::integer end,
    nullif(p_input->>'horizon',''),'open',
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      ||jsonb_build_object('recordingContract','record_operational_escalation_v1')
  )
  on conflict (source_system,source_type,source_id,escalation_kind) do update set
    principal_id=excluded.principal_id,portfolio_unit_id=excluded.portfolio_unit_id,current_state=excluded.current_state,
    threshold_crossed=excluded.threshold_crossed,consequence=excluded.consequence,
    owner_decision_required=excluded.owner_decision_required,options_json=excluded.options_json,severity=excluded.severity,
    floor_class=excluded.floor_class,protection_level=excluded.protection_level,interruptibility=excluded.interruptibility,
    reason_for_floor=excluded.reason_for_floor,window_start=excluded.window_start,window_end=excluded.window_end,
    expected_owner_minutes=excluded.expected_owner_minutes,horizon=excluded.horizon,status='open',resolved_at=null,
    metadata=atlas.operational_escalations.metadata||excluded.metadata
  returning * into v_row;

  return jsonb_build_object('contractVersion','operational_escalation_record_v1','escalation',to_jsonb(v_row));
end;
$function$;

create or replace function atlas.principal_update_operational_escalation_api_v1(p_escalation_id uuid,p_status text,p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_principal_id uuid;
  v_row atlas.operational_escalations%rowtype;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_status not in ('acknowledged','resolved','dismissed') then raise exception 'Escalation status must be acknowledged, resolved, or dismissed.' using errcode='22023'; end if;

  update atlas.operational_escalations e
  set status=p_status,
      resolved_at=case when p_status in ('resolved','dismissed') then now() else null end,
      metadata=e.metadata||jsonb_strip_nulls(jsonb_build_object('principalNote',nullif(p_note,''),'principalUpdatedAt',now()))
  where e.id=p_escalation_id and e.principal_id=v_principal_id
  returning * into v_row;
  if v_row.id is null then raise exception 'Escalation not found for this Principal.' using errcode='P0002'; end if;
  return jsonb_build_object('contractVersion','principal_operational_escalation_update_v1','escalation',to_jsonb(v_row));
end;
$function$;

revoke all on function atlas.current_principal_id_v1() from public;
revoke all on function atlas.principal_set_capacity_policy_api_v1(jsonb) from public;
revoke all on function atlas.principal_upsert_household_rhythm_api_v1(jsonb) from public;
revoke all on function atlas.principal_upsert_household_event_api_v1(jsonb) from public;
revoke all on function atlas.principal_upsert_owner_obligation_api_v1(jsonb) from public;
revoke all on function atlas.record_operational_escalation_v1(uuid,jsonb) from public;
revoke all on function atlas.principal_update_operational_escalation_api_v1(uuid,text,text) from public;

grant execute on function atlas.current_principal_id_v1() to authenticated,service_role;
grant execute on function atlas.principal_set_capacity_policy_api_v1(jsonb) to authenticated,service_role;
grant execute on function atlas.principal_upsert_household_rhythm_api_v1(jsonb) to authenticated,service_role;
grant execute on function atlas.principal_upsert_household_event_api_v1(jsonb) to authenticated,service_role;
grant execute on function atlas.principal_upsert_owner_obligation_api_v1(jsonb) to authenticated,service_role;
grant execute on function atlas.record_operational_escalation_v1(uuid,jsonb) to service_role;
grant execute on function atlas.principal_update_operational_escalation_api_v1(uuid,text,text) to authenticated,service_role;