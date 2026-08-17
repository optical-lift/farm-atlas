create table atlas.house_position_snapshots (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  as_of_at timestamptz not null,
  source text not null,
  coverage_state text not null,
  freshness_state text not null,
  coverage_start timestamptz,
  coverage_end timestamptz,
  included_entities jsonb not null default '[]'::jsonb,
  included_accounts jsonb not null default '[]'::jsonb,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint house_position_snapshots_coverage_check check (coverage_state in ('complete','partial','unknown')),
  constraint house_position_snapshots_freshness_check check (freshness_state in ('current','stale','unknown')),
  constraint house_position_snapshots_coverage_range_check check (coverage_end is null or coverage_start is null or coverage_end >= coverage_start),
  constraint house_position_snapshots_entities_array_check check (jsonb_typeof(included_entities)='array'),
  constraint house_position_snapshots_accounts_array_check check (jsonb_typeof(included_accounts)='array')
);

create index house_position_snapshots_principal_asof_idx
  on atlas.house_position_snapshots(principal_id, as_of_at desc, created_at desc);

create table atlas.house_position_line_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references atlas.house_position_snapshots(id) on delete cascade,
  position_kind text not null,
  label text not null,
  amount numeric not null,
  currency text not null,
  due_at timestamptz,
  portfolio_unit_id uuid references atlas.portfolio_units(id) on delete set null,
  entity_ref text,
  account_ref text,
  source_ref text,
  recurrence jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint house_position_line_items_kind_check check (position_kind in ('liquid_resource','committed_outflow','expected_inflow','recurring_obligation','committed_capital')),
  constraint house_position_line_items_label_nonblank check (btrim(label)<>''),
  constraint house_position_line_items_amount_check check (amount >= 0),
  constraint house_position_line_items_currency_nonblank check (btrim(currency)<>'')
);

create index house_position_line_items_snapshot_currency_idx
  on atlas.house_position_line_items(snapshot_id, currency, position_kind, due_at);

create table atlas.capital_requests (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  portfolio_unit_id uuid references atlas.portfolio_units(id) on delete set null,
  stable_key text not null,
  title text not null,
  amount numeric not null,
  currency text not null,
  needed_by timestamptz,
  reason text not null,
  status text not null default 'requested',
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capital_requests_amount_check check (amount > 0),
  constraint capital_requests_status_check check (status in ('requested','approved','funded','declined','withdrawn')),
  constraint capital_requests_stable_key_nonblank check (btrim(stable_key)<>''),
  unique (principal_id, stable_key)
);

create table atlas.investment_opportunities (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  portfolio_unit_id uuid references atlas.portfolio_units(id) on delete set null,
  stable_key text not null,
  title text not null,
  capital_required numeric,
  currency text,
  readiness_state text not null,
  next_value_milestone text,
  status text not null default 'active',
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint investment_opportunities_capital_check check (capital_required is null or capital_required > 0),
  constraint investment_opportunities_currency_shape_check check (capital_required is null or nullif(btrim(currency),'') is not null),
  constraint investment_opportunities_readiness_check check (readiness_state in ('investment_ready','unfunded','not_ready')),
  constraint investment_opportunities_status_check check (status in ('active','funded','declined','closed')),
  constraint investment_opportunities_stable_key_nonblank check (btrim(stable_key)<>''),
  unique (principal_id, stable_key)
);

revoke all on atlas.house_position_snapshots from public, anon, authenticated, service_role;
revoke all on atlas.house_position_line_items from public, anon, authenticated, service_role;
revoke all on atlas.capital_requests from public, anon, authenticated, service_role;
revoke all on atlas.investment_opportunities from public, anon, authenticated, service_role;
grant all on atlas.house_position_snapshots to postgres;
grant all on atlas.house_position_line_items to postgres;
grant all on atlas.capital_requests to postgres;
grant all on atlas.investment_opportunities to postgres;

create or replace view atlas.house_position_latest_snapshot_v1 as
select distinct on (s.principal_id)
  s.*
from atlas.house_position_snapshots s
order by s.principal_id, s.as_of_at desc, s.created_at desc;

create or replace view atlas.house_position_currency_summary_v1 as
select
  s.principal_id,
  s.id as snapshot_id,
  s.as_of_at,
  s.source,
  s.coverage_state,
  s.freshness_state,
  l.currency,
  sum(l.amount) filter (where l.position_kind='liquid_resource') as liquid_resources,
  sum(l.amount) filter (where l.position_kind='committed_outflow' and l.due_at is not null and l.due_at<=s.as_of_at+interval '30 days') as committed_outflows_30,
  sum(l.amount) filter (where l.position_kind='expected_inflow' and l.due_at is not null and l.due_at<=s.as_of_at+interval '30 days') as expected_inflows_30,
  sum(l.amount) filter (where l.position_kind='committed_outflow' and l.due_at is not null and l.due_at<=s.as_of_at+interval '60 days') as committed_outflows_60,
  sum(l.amount) filter (where l.position_kind='expected_inflow' and l.due_at is not null and l.due_at<=s.as_of_at+interval '60 days') as expected_inflows_60,
  sum(l.amount) filter (where l.position_kind='committed_outflow' and l.due_at is not null and l.due_at<=s.as_of_at+interval '90 days') as committed_outflows_90,
  sum(l.amount) filter (where l.position_kind='expected_inflow' and l.due_at is not null and l.due_at<=s.as_of_at+interval '90 days') as expected_inflows_90,
  sum(l.amount) filter (where l.position_kind='recurring_obligation') as recurring_obligations_recorded,
  sum(l.amount) filter (where l.position_kind='committed_capital') as committed_capital_recorded
from atlas.house_position_snapshots s
join atlas.house_position_line_items l on l.snapshot_id=s.id
group by s.principal_id,s.id,s.as_of_at,s.source,s.coverage_state,s.freshness_state,l.currency;

revoke all on atlas.house_position_latest_snapshot_v1 from public, anon, authenticated, service_role;
revoke all on atlas.house_position_currency_summary_v1 from public, anon, authenticated, service_role;
grant select on atlas.house_position_latest_snapshot_v1 to postgres;
grant select on atlas.house_position_currency_summary_v1 to postgres;

create or replace function atlas.principal_house_position_api_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_snapshot atlas.house_position_snapshots%rowtype;
  v_summaries jsonb;
  v_requests jsonb;
  v_opportunities jsonb;
  v_state text;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then
    return jsonb_build_object('contractVersion','principal_house_position_v1','state','principal_required');
  end if;

  select * into v_snapshot
  from atlas.house_position_snapshots s
  where s.principal_id=v_principal_id
  order by s.as_of_at desc,s.created_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'stableKey',r.stable_key,'title',r.title,'portfolioUnitId',r.portfolio_unit_id,
    'amount',r.amount,'currency',r.currency,'neededBy',r.needed_by,'reason',r.reason,'status',r.status
  ) order by r.needed_by nulls last,r.title),'[]'::jsonb)
  into v_requests
  from atlas.capital_requests r
  where r.principal_id=v_principal_id and r.status in ('requested','approved');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o.id,'stableKey',o.stable_key,'title',o.title,'portfolioUnitId',o.portfolio_unit_id,
    'capitalRequired',o.capital_required,'currency',o.currency,'readinessState',o.readiness_state,
    'nextValueMilestone',o.next_value_milestone,'status',o.status
  ) order by o.readiness_state,o.title),'[]'::jsonb)
  into v_opportunities
  from atlas.investment_opportunities o
  where o.principal_id=v_principal_id and o.status='active';

  if v_snapshot.id is null then
    return jsonb_build_object(
      'contractVersion','principal_house_position_v1',
      'state','source_required',
      'asOf',null,
      'source',null,
      'coverage',jsonb_build_object('state','unknown','start',null,'end',null,'includedEntities','[]'::jsonb,'includedAccounts','[]'::jsonb),
      'freshness','unknown',
      'currencySummaries','[]'::jsonb,
      'capitalRequests',v_requests,
      'investmentOpportunities',v_opportunities
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'currency',x.currency,
    'liquidResources',x.liquid_resources,
    'committedOutflows30',x.committed_outflows_30,
    'expectedInflows30',x.expected_inflows_30,
    'projectedLiquidity30',case when x.liquid_resources is null then null else x.liquid_resources-coalesce(x.committed_outflows_30,0)+coalesce(x.expected_inflows_30,0) end,
    'committedOutflows60',x.committed_outflows_60,
    'expectedInflows60',x.expected_inflows_60,
    'projectedLiquidity60',case when x.liquid_resources is null then null else x.liquid_resources-coalesce(x.committed_outflows_60,0)+coalesce(x.expected_inflows_60,0) end,
    'committedOutflows90',x.committed_outflows_90,
    'expectedInflows90',x.expected_inflows_90,
    'projectedLiquidity90',case when x.liquid_resources is null then null else x.liquid_resources-coalesce(x.committed_outflows_90,0)+coalesce(x.expected_inflows_90,0) end,
    'recurringObligationsRecorded',x.recurring_obligations_recorded,
    'committedCapitalRecorded',x.committed_capital_recorded
  ) order by x.currency),'[]'::jsonb)
  into v_summaries
  from atlas.house_position_currency_summary_v1 x
  where x.snapshot_id=v_snapshot.id;

  v_state:=case
    when v_snapshot.coverage_state='complete' and v_snapshot.freshness_state='current' then 'ready'
    else 'limited'
  end;

  return jsonb_build_object(
    'contractVersion','principal_house_position_v1',
    'state',v_state,
    'snapshotId',v_snapshot.id,
    'asOf',v_snapshot.as_of_at,
    'source',v_snapshot.source,
    'coverage',jsonb_build_object(
      'state',v_snapshot.coverage_state,
      'start',v_snapshot.coverage_start,
      'end',v_snapshot.coverage_end,
      'includedEntities',v_snapshot.included_entities,
      'includedAccounts',v_snapshot.included_accounts
    ),
    'freshness',v_snapshot.freshness_state,
    'currencySummaries',v_summaries,
    'capitalRequests',v_requests,
    'investmentOpportunities',v_opportunities,
    'notes',v_snapshot.notes,
    'metadata',v_snapshot.metadata
  );
end;
$function$;

create or replace function atlas.principal_record_house_position_snapshot_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_snapshot atlas.house_position_snapshots%rowtype;
  v_item jsonb;
  v_unit_id uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'House Position snapshot input must be an object.' using errcode='22023'; end if;
  if nullif(p_input->>'asOfAt','') is null or nullif(btrim(p_input->>'source'),'') is null
     or nullif(p_input->>'coverageState','') is null or nullif(p_input->>'freshnessState','') is null then
    raise exception 'asOfAt, source, coverageState, and freshnessState are required.' using errcode='22023';
  end if;
  if p_input ? 'lineItems' and jsonb_typeof(p_input->'lineItems')<>'array' then raise exception 'lineItems must be an array.' using errcode='22023'; end if;

  insert into atlas.house_position_snapshots(
    principal_id,as_of_at,source,coverage_state,freshness_state,coverage_start,coverage_end,
    included_entities,included_accounts,notes,metadata
  ) values (
    v_principal_id,(p_input->>'asOfAt')::timestamptz,p_input->>'source',p_input->>'coverageState',p_input->>'freshnessState',
    case when nullif(p_input->>'coverageStart','') is null then null else (p_input->>'coverageStart')::timestamptz end,
    case when nullif(p_input->>'coverageEnd','') is null then null else (p_input->>'coverageEnd')::timestamptz end,
    case when jsonb_typeof(p_input->'includedEntities')='array' then p_input->'includedEntities' else '[]'::jsonb end,
    case when jsonb_typeof(p_input->'includedAccounts')='array' then p_input->'includedAccounts' else '[]'::jsonb end,
    nullif(p_input->>'notes',''),
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      || jsonb_build_object('authoringContract','principal_record_house_position_snapshot_api_v1')
  ) returning * into v_snapshot;

  for v_item in select value from jsonb_array_elements(coalesce(p_input->'lineItems','[]'::jsonb))
  loop
    v_unit_id:=null;
    if nullif(v_item->>'portfolioUnitStableKey','') is not null then
      select u.id into v_unit_id from atlas.portfolio_units u
      where u.owner_id=v_principal_id and u.stable_key=v_item->>'portfolioUnitStableKey' and u.archived_at is null;
      if v_unit_id is null then raise exception 'Portfolio unit not found for House Position line item.' using errcode='P0002'; end if;
    end if;

    insert into atlas.house_position_line_items(
      snapshot_id,position_kind,label,amount,currency,due_at,portfolio_unit_id,entity_ref,account_ref,source_ref,recurrence,metadata
    ) values (
      v_snapshot.id,v_item->>'positionKind',v_item->>'label',(v_item->>'amount')::numeric,v_item->>'currency',
      case when nullif(v_item->>'dueAt','') is null then null else (v_item->>'dueAt')::timestamptz end,
      v_unit_id,nullif(v_item->>'entityRef',''),nullif(v_item->>'accountRef',''),nullif(v_item->>'sourceRef',''),
      v_item->'recurrence',case when jsonb_typeof(v_item->'metadata')='object' then v_item->'metadata' else '{}'::jsonb end
    );
  end loop;

  return jsonb_build_object(
    'contractVersion','principal_house_position_snapshot_authoring_v1',
    'snapshotId',v_snapshot.id,
    'housePosition',atlas.principal_house_position_api_v1()
  );
end;
$function$;

revoke all on function atlas.principal_house_position_api_v1() from public, anon, authenticated, service_role;
revoke all on function atlas.principal_record_house_position_snapshot_api_v1(jsonb) from public, anon, authenticated, service_role;
grant execute on function atlas.principal_house_position_api_v1() to authenticated, service_role, postgres;
grant execute on function atlas.principal_record_house_position_snapshot_api_v1(jsonb) to authenticated, service_role, postgres;

comment on function atlas.principal_house_position_api_v1() is
'Principal Treasury / House Position read contract. Missing financial source data returns source_required with unknown coverage/freshness; missing values are never represented as zero.';
comment on table atlas.house_position_snapshots is
'Immutable House Position source snapshot with explicit as-of, freshness, coverage, and included entity/account declarations.';