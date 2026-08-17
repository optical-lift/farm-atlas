create or replace function atlas.principal_upsert_capital_request_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_unit_id uuid;
  v_row atlas.capital_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Capital request input must be an object.' using errcode='22023'; end if;
  if nullif(btrim(p_input->>'stableKey'),'') is null
     or nullif(btrim(p_input->>'title'),'') is null
     or nullif(p_input->>'amount','') is null
     or nullif(btrim(p_input->>'currency'),'') is null
     or nullif(btrim(p_input->>'reason'),'') is null then
    raise exception 'stableKey, title, amount, currency, and reason are required.' using errcode='22023';
  end if;

  if nullif(p_input->>'portfolioUnitStableKey','') is not null then
    select u.id into v_unit_id from atlas.portfolio_units u
    where u.owner_id=v_principal_id and u.stable_key=p_input->>'portfolioUnitStableKey' and u.archived_at is null;
    if v_unit_id is null then raise exception 'Portfolio unit not found for this Principal.' using errcode='P0002'; end if;
  end if;

  insert into atlas.capital_requests(
    principal_id,portfolio_unit_id,stable_key,title,amount,currency,needed_by,reason,status,source,metadata
  ) values (
    v_principal_id,v_unit_id,p_input->>'stableKey',p_input->>'title',(p_input->>'amount')::numeric,p_input->>'currency',
    case when nullif(p_input->>'neededBy','') is null then null else (p_input->>'neededBy')::timestamptz end,
    p_input->>'reason',coalesce(nullif(p_input->>'status',''),'requested'),coalesce(nullif(p_input->>'source',''),'principal_authoring'),
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      || jsonb_build_object('authoringContract','principal_upsert_capital_request_api_v1')
  )
  on conflict (principal_id,stable_key) do update set
    portfolio_unit_id=excluded.portfolio_unit_id,title=excluded.title,amount=excluded.amount,currency=excluded.currency,
    needed_by=excluded.needed_by,reason=excluded.reason,status=excluded.status,source=excluded.source,
    metadata=atlas.capital_requests.metadata||excluded.metadata,updated_at=now()
  returning * into v_row;

  return jsonb_build_object('contractVersion','principal_capital_request_authoring_v1','capitalRequest',to_jsonb(v_row));
end;
$function$;

create or replace function atlas.principal_upsert_investment_opportunity_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_unit_id uuid;
  v_row atlas.investment_opportunities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Investment opportunity input must be an object.' using errcode='22023'; end if;
  if nullif(btrim(p_input->>'stableKey'),'') is null
     or nullif(btrim(p_input->>'title'),'') is null
     or nullif(p_input->>'readinessState','') is null then
    raise exception 'stableKey, title, and readinessState are required.' using errcode='22023';
  end if;
  if nullif(p_input->>'capitalRequired','') is not null and nullif(btrim(p_input->>'currency'),'') is null then
    raise exception 'currency is required when capitalRequired is supplied.' using errcode='22023';
  end if;

  if nullif(p_input->>'portfolioUnitStableKey','') is not null then
    select u.id into v_unit_id from atlas.portfolio_units u
    where u.owner_id=v_principal_id and u.stable_key=p_input->>'portfolioUnitStableKey' and u.archived_at is null;
    if v_unit_id is null then raise exception 'Portfolio unit not found for this Principal.' using errcode='P0002'; end if;
  end if;

  insert into atlas.investment_opportunities(
    principal_id,portfolio_unit_id,stable_key,title,capital_required,currency,readiness_state,next_value_milestone,status,source,metadata
  ) values (
    v_principal_id,v_unit_id,p_input->>'stableKey',p_input->>'title',
    case when nullif(p_input->>'capitalRequired','') is null then null else (p_input->>'capitalRequired')::numeric end,
    nullif(p_input->>'currency',''),p_input->>'readinessState',nullif(p_input->>'nextValueMilestone',''),
    coalesce(nullif(p_input->>'status',''),'active'),coalesce(nullif(p_input->>'source',''),'principal_authoring'),
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      || jsonb_build_object('authoringContract','principal_upsert_investment_opportunity_api_v1')
  )
  on conflict (principal_id,stable_key) do update set
    portfolio_unit_id=excluded.portfolio_unit_id,title=excluded.title,capital_required=excluded.capital_required,
    currency=excluded.currency,readiness_state=excluded.readiness_state,next_value_milestone=excluded.next_value_milestone,
    status=excluded.status,source=excluded.source,metadata=atlas.investment_opportunities.metadata||excluded.metadata,updated_at=now()
  returning * into v_row;

  return jsonb_build_object('contractVersion','principal_investment_opportunity_authoring_v1','investmentOpportunity',to_jsonb(v_row));
end;
$function$;

create or replace function atlas.principal_office_context_api_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_theses jsonb;
  v_attention jsonb;
  v_functions jsonb;
  v_scores jsonb;
  v_house_position jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then
    return jsonb_build_object('contractVersion','principal_office_context_v1','state','principal_required');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'stableKey',t.stable_key,'portfolioUnitId',t.portfolio_unit_id,'portfolioUnitStableKey',u.stable_key,
    'portfolioUnitName',u.name,'horizon',u.horizon,'thesisStatement',t.thesis_statement,'valueCreationLogic',t.value_creation_logic,
    'mustBecomeTrue',t.must_become_true,'capitalRequired',t.capital_required,'nextValueMilestone',t.next_value_milestone,
    'assumptions',t.assumptions,'reconsiderationConditions',t.reconsideration_conditions,
    'reviewCadenceDays',t.review_cadence_days,'nextReviewAt',t.next_review_at,'status',t.status,'source',t.source
  ) order by case u.horizon when 'H1' then 1 when 'H2' then 2 else 3 end,u.name,t.stable_key),'[]'::jsonb)
  into v_theses
  from atlas.portfolio_theses t
  join atlas.portfolio_units u on u.id=t.portfolio_unit_id
  where t.principal_id=v_principal_id and t.status in ('draft','active');

  select coalesce(jsonb_agg(jsonb_build_object(
    'subjectId',a.subject_id,'subjectStableKey',a.subject_stable_key,'subjectType',a.subject_type,'title',a.title,
    'portfolioUnitId',a.portfolio_unit_id,'horizon',a.horizon,'policyId',a.policy_id,'policyStableKey',a.policy_stable_key,
    'cadenceDays',a.cadence_days,'protectedOwnerMinutes',a.protected_owner_minutes,'floorClass',a.floor_class,
    'protectionLevel',a.protection_level,'lastMeaningfulAt',a.last_meaningful_at,'nextDueAt',a.next_due_at,
    'attentionState',a.attention_state,'attentionDebtDays',a.attention_debt_days,'consequence',a.consequence,'reasonForFloor',a.reason_for_floor
  ) order by case a.horizon when 'H1' then 1 when 'H2' then 2 when 'H3' then 3 else 4 end,a.next_due_at,a.title),'[]'::jsonb)
  into v_attention
  from atlas.attention_debt_v1 a
  where a.principal_id=v_principal_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'stableKey',f.stable_key,'name',f.name,'charter',f.charter,'portfolioUnitId',f.portfolio_unit_id,
    'accountablePersonId',f.accountable_person_id,'capacityState',f.capacity_state,'reviewCadenceDays',f.review_cadence_days,
    'active',f.active,'source',f.source
  ) order by f.name),'[]'::jsonb)
  into v_functions
  from atlas.operating_functions f
  where f.principal_id=v_principal_id and f.active;

  select coalesce(jsonb_agg(jsonb_build_object(
    'scorecardId',g.scorecard_id,'stableKey',g.stable_key,'name',g.name,'criticalNumber',g.critical_number,'drivers',g.drivers,
    'operatingFunctionId',g.operating_function_id,'functionName',g.function_name,'portfolioUnitId',g.portfolio_unit_id,
    'portfolioUnitName',g.portfolio_unit_name,'horizon',g.horizon,'accountableOperatorId',g.accountable_operator_id,
    'asOf',g.as_of_at,'actual',g.actual,'forecast',g.forecast,'target',g.target,'trend',g.trend,'nextPlay',g.next_play,
    'measurementState',g.measurement_state
  ) order by g.name),'[]'::jsonb)
  into v_scores
  from atlas.great_game_latest_v1 g
  where g.principal_id=v_principal_id;

  v_house_position:=atlas.principal_house_position_api_v1();

  return jsonb_build_object(
    'contractVersion','principal_office_context_v1',
    'state','ready',
    'portfolioTheses',v_theses,
    'attention',v_attention,
    'operatingFunctions',v_functions,
    'greatGame',v_scores,
    'housePosition',v_house_position
  );
end;
$function$;

revoke all on function atlas.principal_upsert_capital_request_api_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function atlas.principal_upsert_investment_opportunity_api_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function atlas.principal_office_context_api_v1() from public, anon, authenticated, service_role;
grant execute on function atlas.principal_upsert_capital_request_api_v1(jsonb) to authenticated, service_role, postgres;
grant execute on function atlas.principal_upsert_investment_opportunity_api_v1(jsonb) to authenticated, service_role, postgres;
grant execute on function atlas.principal_office_context_api_v1() to authenticated, service_role, postgres;

comment on function atlas.principal_office_context_api_v1() is
'Principal Office read contract for explicit portfolio theses, attention state, durable functions, Great Game scoreboards, and House Position.';