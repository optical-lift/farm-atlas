create table atlas.operating_functions (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  organization_id uuid not null,
  portfolio_unit_id uuid references atlas.portfolio_units(id) on delete cascade,
  stable_key text not null,
  name text not null,
  charter text not null,
  accountable_person_id uuid,
  capacity_state text,
  review_cadence_days integer,
  active boolean not null default true,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operating_functions_stable_key_nonblank check (btrim(stable_key) <> ''),
  constraint operating_functions_name_nonblank check (btrim(name) <> ''),
  constraint operating_functions_charter_nonblank check (btrim(charter) <> ''),
  constraint operating_functions_review_cadence_check check (review_cadence_days is null or review_cadence_days > 0),
  unique (principal_id, stable_key)
);

create index operating_functions_principal_active_idx
  on atlas.operating_functions(principal_id, active, portfolio_unit_id);

create table atlas.great_game_scorecards (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  operating_function_id uuid references atlas.operating_functions(id) on delete cascade,
  portfolio_unit_id uuid references atlas.portfolio_units(id) on delete cascade,
  stable_key text not null,
  name text not null,
  critical_number text not null,
  drivers jsonb not null default '[]'::jsonb,
  accountable_operator_id uuid,
  active boolean not null default true,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint great_game_scorecards_stable_key_nonblank check (btrim(stable_key) <> ''),
  constraint great_game_scorecards_name_nonblank check (btrim(name) <> ''),
  constraint great_game_scorecards_critical_number_nonblank check (btrim(critical_number) <> ''),
  constraint great_game_scorecards_scope_check check (operating_function_id is not null or portfolio_unit_id is not null),
  unique (principal_id, stable_key)
);

create index great_game_scorecards_principal_active_idx
  on atlas.great_game_scorecards(principal_id, active, portfolio_unit_id, operating_function_id);

create table atlas.great_game_score_updates (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references atlas.great_game_scorecards(id) on delete cascade,
  as_of_at timestamptz not null,
  actual jsonb,
  forecast jsonb,
  target jsonb,
  trend text not null default 'unknown',
  next_play text,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint great_game_score_updates_trend_check check (trend in ('improving','stable','worsening','unknown')),
  constraint great_game_score_updates_signal_check check (actual is not null or forecast is not null or target is not null or next_play is not null)
);

create index great_game_score_updates_scorecard_asof_idx
  on atlas.great_game_score_updates(scorecard_id, as_of_at desc, created_at desc);

revoke all on atlas.operating_functions from public, anon, authenticated, service_role;
revoke all on atlas.great_game_scorecards from public, anon, authenticated, service_role;
revoke all on atlas.great_game_score_updates from public, anon, authenticated, service_role;
grant all on atlas.operating_functions to postgres;
grant all on atlas.great_game_scorecards to postgres;
grant all on atlas.great_game_score_updates to postgres;

create or replace view atlas.great_game_latest_v1 as
with latest as (
  select distinct on (u.scorecard_id)
    u.scorecard_id,
    u.id as update_id,
    u.as_of_at,
    u.actual,
    u.forecast,
    u.target,
    u.trend,
    u.next_play,
    u.source as update_source,
    u.metadata as update_metadata
  from atlas.great_game_score_updates u
  order by u.scorecard_id, u.as_of_at desc, u.created_at desc
)
select
  s.principal_id,
  s.id as scorecard_id,
  s.stable_key,
  s.name,
  s.critical_number,
  s.drivers,
  s.operating_function_id,
  f.name as function_name,
  s.portfolio_unit_id,
  p.name as portfolio_unit_name,
  p.horizon,
  coalesce(s.accountable_operator_id,f.accountable_person_id) as accountable_operator_id,
  l.update_id,
  l.as_of_at,
  l.actual,
  l.forecast,
  l.target,
  coalesce(l.trend,'unknown') as trend,
  l.next_play,
  case when l.update_id is null then 'measurement_required' else 'measured' end as measurement_state,
  s.metadata || coalesce(l.update_metadata,'{}'::jsonb) as metadata
from atlas.great_game_scorecards s
left join atlas.operating_functions f on f.id=s.operating_function_id
left join atlas.portfolio_units p on p.id=coalesce(s.portfolio_unit_id,f.portfolio_unit_id)
left join latest l on l.scorecard_id=s.id
where s.active;

revoke all on atlas.great_game_latest_v1 from public, anon, authenticated, service_role;
grant select on atlas.great_game_latest_v1 to postgres;

create or replace function atlas.principal_upsert_operating_function_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal atlas.principals%rowtype;
  v_unit atlas.portfolio_units%rowtype;
  v_row atlas.operating_functions%rowtype;
  v_key text;
  v_name text;
  v_charter text;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  select * into v_principal from atlas.principals p where p.user_id=auth.uid() and p.status='active' limit 1;
  if v_principal.id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Operating function input must be an object.' using errcode='22023'; end if;

  v_key:=nullif(btrim(p_input->>'stableKey'),'');
  v_name:=nullif(btrim(p_input->>'name'),'');
  v_charter:=nullif(btrim(p_input->>'charter'),'');
  if v_key is null or v_name is null or v_charter is null then raise exception 'stableKey, name, and charter are required.' using errcode='22023'; end if;

  if nullif(p_input->>'portfolioUnitStableKey','') is not null then
    select * into v_unit from atlas.portfolio_units u
    where u.owner_id=v_principal.id and u.stable_key=p_input->>'portfolioUnitStableKey' and u.archived_at is null;
    if v_unit.id is null then raise exception 'Portfolio unit not found for this Principal.' using errcode='P0002'; end if;
  end if;

  insert into atlas.operating_functions(
    principal_id,organization_id,portfolio_unit_id,stable_key,name,charter,accountable_person_id,
    capacity_state,review_cadence_days,active,source,metadata
  ) values (
    v_principal.id,v_principal.organization_id,v_unit.id,v_key,v_name,v_charter,
    case when nullif(p_input->>'accountablePersonId','') is null then null else (p_input->>'accountablePersonId')::uuid end,
    nullif(p_input->>'capacityState',''),
    case when nullif(p_input->>'reviewCadenceDays','') is null then null else (p_input->>'reviewCadenceDays')::integer end,
    coalesce((p_input->>'active')::boolean,true),
    coalesce(nullif(p_input->>'source',''),'principal_authoring'),
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      || jsonb_build_object('authoringContract','principal_upsert_operating_function_api_v1')
  )
  on conflict (principal_id,stable_key) do update set
    portfolio_unit_id=excluded.portfolio_unit_id,
    name=excluded.name,
    charter=excluded.charter,
    accountable_person_id=excluded.accountable_person_id,
    capacity_state=excluded.capacity_state,
    review_cadence_days=excluded.review_cadence_days,
    active=excluded.active,
    source=excluded.source,
    metadata=atlas.operating_functions.metadata||excluded.metadata,
    updated_at=now()
  returning * into v_row;

  return jsonb_build_object('contractVersion','principal_operating_function_authoring_v1','operatingFunction',to_jsonb(v_row));
end;
$function$;

create or replace function atlas.principal_upsert_great_game_scorecard_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_function atlas.operating_functions%rowtype;
  v_unit atlas.portfolio_units%rowtype;
  v_row atlas.great_game_scorecards%rowtype;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Great Game scorecard input must be an object.' using errcode='22023'; end if;
  if nullif(btrim(p_input->>'stableKey'),'') is null or nullif(btrim(p_input->>'name'),'') is null or nullif(btrim(p_input->>'criticalNumber'),'') is null then
    raise exception 'stableKey, name, and criticalNumber are required.' using errcode='22023';
  end if;

  if nullif(p_input->>'operatingFunctionStableKey','') is not null then
    select * into v_function from atlas.operating_functions f
    where f.principal_id=v_principal_id and f.stable_key=p_input->>'operatingFunctionStableKey' and f.active;
    if v_function.id is null then raise exception 'Operating function not found for this Principal.' using errcode='P0002'; end if;
  end if;
  if nullif(p_input->>'portfolioUnitStableKey','') is not null then
    select * into v_unit from atlas.portfolio_units u
    where u.owner_id=v_principal_id and u.stable_key=p_input->>'portfolioUnitStableKey' and u.archived_at is null;
    if v_unit.id is null then raise exception 'Portfolio unit not found for this Principal.' using errcode='P0002'; end if;
  end if;
  if v_function.id is null and v_unit.id is null then raise exception 'operatingFunctionStableKey or portfolioUnitStableKey is required.' using errcode='22023'; end if;

  insert into atlas.great_game_scorecards(
    principal_id,operating_function_id,portfolio_unit_id,stable_key,name,critical_number,drivers,
    accountable_operator_id,active,source,metadata
  ) values (
    v_principal_id,v_function.id,v_unit.id,p_input->>'stableKey',p_input->>'name',p_input->>'criticalNumber',
    case when jsonb_typeof(p_input->'drivers')='array' then p_input->'drivers' else '[]'::jsonb end,
    case when nullif(p_input->>'accountableOperatorId','') is null then null else (p_input->>'accountableOperatorId')::uuid end,
    coalesce((p_input->>'active')::boolean,true),coalesce(nullif(p_input->>'source',''),'principal_authoring'),
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      || jsonb_build_object('authoringContract','principal_upsert_great_game_scorecard_api_v1')
  )
  on conflict (principal_id,stable_key) do update set
    operating_function_id=excluded.operating_function_id,
    portfolio_unit_id=excluded.portfolio_unit_id,
    name=excluded.name,
    critical_number=excluded.critical_number,
    drivers=excluded.drivers,
    accountable_operator_id=excluded.accountable_operator_id,
    active=excluded.active,
    source=excluded.source,
    metadata=atlas.great_game_scorecards.metadata||excluded.metadata,
    updated_at=now()
  returning * into v_row;

  return jsonb_build_object('contractVersion','principal_great_game_scorecard_authoring_v1','scorecard',to_jsonb(v_row));
end;
$function$;

create or replace function atlas.principal_record_great_game_score_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_scorecard atlas.great_game_scorecards%rowtype;
  v_update atlas.great_game_score_updates%rowtype;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Great Game score update input must be an object.' using errcode='22023'; end if;

  select * into v_scorecard from atlas.great_game_scorecards s
  where s.principal_id=v_principal_id and s.stable_key=p_input->>'scorecardStableKey' and s.active;
  if v_scorecard.id is null then raise exception 'Great Game scorecard not found for this Principal.' using errcode='P0002'; end if;

  insert into atlas.great_game_score_updates(scorecard_id,as_of_at,actual,forecast,target,trend,next_play,source,metadata)
  values (
    v_scorecard.id,
    coalesce(nullif(p_input->>'asOfAt','')::timestamptz,now()),
    p_input->'actual',p_input->'forecast',p_input->'target',coalesce(nullif(p_input->>'trend',''),'unknown'),nullif(p_input->>'nextPlay',''),
    coalesce(nullif(p_input->>'source',''),'principal_authoring'),
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      || jsonb_build_object('authoringContract','principal_record_great_game_score_api_v1')
  )
  returning * into v_update;

  return jsonb_build_object(
    'contractVersion','principal_great_game_score_update_v1',
    'update',to_jsonb(v_update),
    'latest',(select to_jsonb(g) from atlas.great_game_latest_v1 g where g.scorecard_id=v_scorecard.id)
  );
end;
$function$;

revoke all on function atlas.principal_upsert_operating_function_api_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function atlas.principal_upsert_great_game_scorecard_api_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function atlas.principal_record_great_game_score_api_v1(jsonb) from public, anon, authenticated, service_role;
grant execute on function atlas.principal_upsert_operating_function_api_v1(jsonb) to authenticated, service_role, postgres;
grant execute on function atlas.principal_upsert_great_game_scorecard_api_v1(jsonb) to authenticated, service_role, postgres;
grant execute on function atlas.principal_record_great_game_score_api_v1(jsonb) to authenticated, service_role, postgres;

comment on table atlas.operating_functions is
'Durable Principal Office functions. Accountable people may change without redefining the function.';
comment on view atlas.great_game_latest_v1 is
'Latest Great Game score for each explicit scorecard. Scoreboards summarize operating health; they do not themselves become Principal Clock work.';