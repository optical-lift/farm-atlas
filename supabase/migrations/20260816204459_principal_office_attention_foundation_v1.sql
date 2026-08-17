create table atlas.portfolio_theses (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  portfolio_unit_id uuid not null references atlas.portfolio_units(id) on delete cascade,
  stable_key text not null,
  thesis_statement text not null,
  value_creation_logic text,
  must_become_true jsonb not null default '[]'::jsonb,
  capital_required jsonb not null default '{}'::jsonb,
  next_value_milestone text,
  assumptions jsonb not null default '[]'::jsonb,
  reconsideration_conditions jsonb not null default '[]'::jsonb,
  review_cadence_days integer,
  next_review_at timestamptz,
  status text not null default 'draft',
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolio_theses_stable_key_nonblank check (btrim(stable_key) <> ''),
  constraint portfolio_theses_statement_nonblank check (btrim(thesis_statement) <> ''),
  constraint portfolio_theses_review_cadence_check check (review_cadence_days is null or review_cadence_days > 0),
  constraint portfolio_theses_status_check check (status in ('draft','active','superseded','retired')),
  unique (portfolio_unit_id, stable_key)
);

create index portfolio_theses_principal_unit_idx
  on atlas.portfolio_theses(principal_id, portfolio_unit_id, status);

create table atlas.attention_subjects (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references atlas.principals(id) on delete cascade,
  portfolio_unit_id uuid references atlas.portfolio_units(id) on delete cascade,
  stable_key text not null,
  subject_type text not null,
  title text not null,
  active boolean not null default true,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attention_subjects_stable_key_nonblank check (btrim(stable_key) <> ''),
  constraint attention_subjects_title_nonblank check (btrim(title) <> ''),
  constraint attention_subjects_type_check check (subject_type in ('portfolio_unit','household','function','domain','other')),
  constraint attention_subjects_portfolio_shape_check check (subject_type <> 'portfolio_unit' or portfolio_unit_id is not null),
  unique (principal_id, stable_key)
);

create index attention_subjects_principal_active_idx
  on atlas.attention_subjects(principal_id, active, portfolio_unit_id);

create table atlas.attention_policies (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references atlas.attention_subjects(id) on delete cascade,
  stable_key text not null,
  cadence_days integer not null,
  first_due_at timestamptz not null,
  protected_owner_minutes integer not null,
  floor_class smallint not null,
  protection_level text not null,
  interruptibility text not null default 'low_interruptibility',
  consequence text not null,
  reason_for_floor text not null,
  effective_from timestamptz not null default now(),
  effective_through timestamptz,
  active boolean not null default true,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attention_policies_stable_key_nonblank check (btrim(stable_key) <> ''),
  constraint attention_policies_cadence_check check (cadence_days > 0),
  constraint attention_policies_minutes_check check (protected_owner_minutes > 0),
  constraint attention_policies_floor_class_check check (floor_class between 1 and 7),
  constraint attention_policies_protection_check check (protection_level in ('critical','protected','standard','optional')),
  constraint attention_policies_interruptibility_check check (interruptibility in ('interruptible','low_interruptibility','should_not_interrupt')),
  constraint attention_policies_effective_check check (effective_through is null or effective_through >= effective_from),
  unique (subject_id, stable_key)
);

create index attention_policies_subject_active_idx
  on atlas.attention_policies(subject_id, active, first_due_at);

create table atlas.attention_events (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references atlas.attention_subjects(id) on delete cascade,
  occurred_at timestamptz not null,
  event_kind text not null,
  meaningful boolean not null default true,
  minutes integer,
  notes text,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint attention_events_kind_check check (event_kind in ('review','decision','planning','capital','communication','other')),
  constraint attention_events_minutes_check check (minutes is null or minutes > 0)
);

create index attention_events_subject_meaningful_idx
  on atlas.attention_events(subject_id, meaningful, occurred_at desc);

revoke all on atlas.portfolio_theses from public, anon, authenticated, service_role;
revoke all on atlas.attention_subjects from public, anon, authenticated, service_role;
revoke all on atlas.attention_policies from public, anon, authenticated, service_role;
revoke all on atlas.attention_events from public, anon, authenticated, service_role;
grant all on atlas.portfolio_theses to postgres;
grant all on atlas.attention_subjects to postgres;
grant all on atlas.attention_policies to postgres;
grant all on atlas.attention_events to postgres;

create or replace view atlas.attention_debt_v1 as
with last_meaningful as (
  select distinct on (e.subject_id)
    e.subject_id,
    e.id as event_id,
    e.occurred_at,
    e.event_kind,
    e.minutes
  from atlas.attention_events e
  where e.meaningful
  order by e.subject_id, e.occurred_at desc, e.created_at desc
), resolved as (
  select
    s.principal_id,
    s.id as subject_id,
    s.stable_key as subject_stable_key,
    s.subject_type,
    s.title,
    s.portfolio_unit_id,
    u.horizon,
    p.id as policy_id,
    p.stable_key as policy_stable_key,
    p.cadence_days,
    p.first_due_at,
    p.protected_owner_minutes,
    p.floor_class,
    p.protection_level,
    p.interruptibility,
    p.consequence,
    p.reason_for_floor,
    lm.event_id as last_meaningful_event_id,
    lm.occurred_at as last_meaningful_at,
    lm.event_kind as last_meaningful_kind,
    case
      when lm.occurred_at is null then p.first_due_at
      else greatest(p.first_due_at, lm.occurred_at + make_interval(days => p.cadence_days))
    end as next_due_at,
    s.metadata || jsonb_build_object(
      'attentionPolicyId', p.id,
      'attentionPolicyStableKey', p.stable_key,
      'lastMeaningfulEventId', lm.event_id,
      'lastMeaningfulKind', lm.event_kind
    ) as metadata
  from atlas.attention_subjects s
  join atlas.attention_policies p on p.subject_id=s.id and p.active
  left join atlas.portfolio_units u on u.id=s.portfolio_unit_id
  left join last_meaningful lm on lm.subject_id=s.id
  where s.active
    and p.effective_from <= now()
    and (p.effective_through is null or p.effective_through >= now())
)
select
  r.*,
  case when r.next_due_at <= now() then 'needs_attention' else 'scheduled' end as attention_state,
  greatest(0, floor(extract(epoch from (now() - r.next_due_at)) / 86400.0)::integer) as attention_debt_days
from resolved r;

revoke all on atlas.attention_debt_v1 from public, anon, authenticated, service_role;
grant select on atlas.attention_debt_v1 to postgres;

create or replace view atlas.principal_clock_candidates_v1 as
select
  o.principal_id,
  o.domain,
  'owner_obligation'::text as source_type,
  o.id as source_id,
  o.title,
  o.floor_class,
  o.becomes_relevant_at as window_start,
  coalesce(o.expires_at,o.must_finish_by) as window_end,
  o.fixed_at as fixed_start,
  o.must_begin_by,
  o.must_finish_by,
  o.expected_minutes,
  o.protection_level,
  o.interruptibility,
  o.delegable,
  o.owner_required,
  o.consequence_of_delay as consequence,
  o.reason_for_floor,
  o.portfolio_unit_id,
  o.horizon,
  o.metadata
from atlas.owner_obligations o
where o.status in ('open','in_progress')
union all
select
  h.principal_id,
  'household'::text as domain,
  'household_event'::text as source_type,
  e.id as source_id,
  e.title,
  e.floor_class,
  e.starts_at as window_start,
  e.ends_at as window_end,
  case when e.fixed then e.starts_at else null::timestamptz end as fixed_start,
  null::timestamptz as must_begin_by,
  e.ends_at as must_finish_by,
  coalesce(e.expected_minutes,greatest(1,round(extract(epoch from e.ends_at-e.starts_at)/60.0)::integer)) as expected_minutes,
  e.protection_level,
  e.interruptibility,
  false as delegable,
  e.principal_required as owner_required,
  e.consequence,
  e.reason_for_floor,
  null::uuid as portfolio_unit_id,
  null::text as horizon,
  e.metadata
from atlas.household_events e
join atlas.households h on h.id=e.household_id
where e.principal_required
union all
select
  h.principal_id,
  'household'::text as domain,
  'household_rhythm'::text as source_type,
  r.id as source_id,
  r.title,
  r.floor_class,
  r.next_window_start as window_start,
  r.next_window_end as window_end,
  null::timestamptz as fixed_start,
  r.next_window_start as must_begin_by,
  r.next_window_end as must_finish_by,
  r.expected_minutes,
  r.protection_level,
  r.interruptibility,
  false as delegable,
  r.principal_required as owner_required,
  r.consequence,
  r.reason_for_floor,
  null::uuid as portfolio_unit_id,
  null::text as horizon,
  r.metadata
from atlas.household_rhythms r
join atlas.households h on h.id=r.household_id
where r.active and r.principal_required and r.next_window_start is not null
union all
select
  e.principal_id,
  'operations'::text as domain,
  'operational_escalation'::text as source_type,
  e.id as source_id,
  e.escalation_kind as title,
  e.floor_class,
  e.window_start,
  e.window_end,
  null::timestamptz as fixed_start,
  e.window_start as must_begin_by,
  e.window_end as must_finish_by,
  e.expected_owner_minutes as expected_minutes,
  e.protection_level,
  e.interruptibility,
  false as delegable,
  true as owner_required,
  e.consequence,
  e.reason_for_floor,
  e.portfolio_unit_id,
  e.horizon,
  e.metadata || jsonb_build_object(
    'sourceSystem',e.source_system,
    'sourceType',e.source_type,
    'sourceId',e.source_id,
    'thresholdCrossed',e.threshold_crossed,
    'ownerDecisionRequired',e.owner_decision_required,
    'severity',e.severity,
    'options',e.options_json
  ) as metadata
from atlas.operational_escalations e
where e.status in ('open','acknowledged')
union all
select
  b.principal_id,
  'principal_capacity'::text as domain,
  'capacity_block'::text as source_type,
  b.id as source_id,
  b.title,
  b.floor_class,
  b.starts_at as window_start,
  b.ends_at as window_end,
  b.starts_at as fixed_start,
  b.starts_at as must_begin_by,
  b.ends_at as must_finish_by,
  greatest(1,round(extract(epoch from b.ends_at-b.starts_at)/60.0)::integer) as expected_minutes,
  b.protection_level,
  b.interruptibility,
  false as delegable,
  true as owner_required,
  b.consequence,
  b.reason_for_floor,
  null::uuid as portfolio_unit_id,
  null::text as horizon,
  b.metadata
from atlas.principal_capacity_blocks b
where b.blocks_capacity
union all
select
  a.principal_id,
  'attention'::text as domain,
  'attention_debt'::text as source_type,
  a.subject_id as source_id,
  a.title,
  a.floor_class,
  a.next_due_at as window_start,
  null::timestamptz as window_end,
  null::timestamptz as fixed_start,
  a.next_due_at as must_begin_by,
  null::timestamptz as must_finish_by,
  a.protected_owner_minutes as expected_minutes,
  a.protection_level,
  a.interruptibility,
  false as delegable,
  true as owner_required,
  a.consequence,
  a.reason_for_floor,
  a.portfolio_unit_id,
  a.horizon,
  a.metadata || jsonb_build_object(
    'attentionState',a.attention_state,
    'attentionDebtDays',a.attention_debt_days,
    'lastMeaningfulAt',a.last_meaningful_at,
    'nextDueAt',a.next_due_at,
    'policyId',a.policy_id
  ) as metadata
from atlas.attention_debt_v1 a
where a.attention_state='needs_attention';

revoke all on atlas.principal_clock_candidates_v1 from public, anon, authenticated, service_role;
grant select on atlas.principal_clock_candidates_v1 to postgres;

create or replace function atlas.principal_upsert_portfolio_thesis_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_unit atlas.portfolio_units%rowtype;
  v_row atlas.portfolio_theses%rowtype;
  v_stable_key text;
  v_statement text;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Portfolio thesis input must be an object.' using errcode='22023'; end if;

  v_stable_key:=nullif(btrim(p_input->>'stableKey'),'');
  v_statement:=nullif(btrim(p_input->>'thesisStatement'),'');
  if v_stable_key is null or v_statement is null or nullif(btrim(p_input->>'portfolioUnitStableKey'),'') is null then
    raise exception 'portfolioUnitStableKey, stableKey, and thesisStatement are required.' using errcode='22023';
  end if;

  select * into v_unit
  from atlas.portfolio_units u
  where u.owner_id=v_principal_id
    and u.stable_key=p_input->>'portfolioUnitStableKey'
    and u.archived_at is null;
  if v_unit.id is null then raise exception 'Portfolio unit not found for this Principal.' using errcode='P0002'; end if;

  insert into atlas.portfolio_theses(
    principal_id,portfolio_unit_id,stable_key,thesis_statement,value_creation_logic,
    must_become_true,capital_required,next_value_milestone,assumptions,reconsideration_conditions,
    review_cadence_days,next_review_at,status,source,metadata
  ) values (
    v_principal_id,v_unit.id,v_stable_key,v_statement,nullif(p_input->>'valueCreationLogic',''),
    case when jsonb_typeof(p_input->'mustBecomeTrue')='array' then p_input->'mustBecomeTrue' else '[]'::jsonb end,
    case when jsonb_typeof(p_input->'capitalRequired')='object' then p_input->'capitalRequired' else '{}'::jsonb end,
    nullif(p_input->>'nextValueMilestone',''),
    case when jsonb_typeof(p_input->'assumptions')='array' then p_input->'assumptions' else '[]'::jsonb end,
    case when jsonb_typeof(p_input->'reconsiderationConditions')='array' then p_input->'reconsiderationConditions' else '[]'::jsonb end,
    case when nullif(p_input->>'reviewCadenceDays','') is null then null else (p_input->>'reviewCadenceDays')::integer end,
    case when nullif(p_input->>'nextReviewAt','') is null then null else (p_input->>'nextReviewAt')::timestamptz end,
    coalesce(nullif(p_input->>'status',''),'draft'),
    coalesce(nullif(p_input->>'source',''),'principal_authoring'),
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      || jsonb_build_object('authoringContract','principal_upsert_portfolio_thesis_api_v1')
  )
  on conflict (portfolio_unit_id,stable_key) do update set
    thesis_statement=excluded.thesis_statement,
    value_creation_logic=excluded.value_creation_logic,
    must_become_true=excluded.must_become_true,
    capital_required=excluded.capital_required,
    next_value_milestone=excluded.next_value_milestone,
    assumptions=excluded.assumptions,
    reconsideration_conditions=excluded.reconsideration_conditions,
    review_cadence_days=excluded.review_cadence_days,
    next_review_at=excluded.next_review_at,
    status=excluded.status,
    source=excluded.source,
    metadata=atlas.portfolio_theses.metadata||excluded.metadata,
    updated_at=now()
  returning * into v_row;

  return jsonb_build_object(
    'contractVersion','principal_portfolio_thesis_authoring_v1',
    'portfolioUnit',jsonb_build_object('id',v_unit.id,'stableKey',v_unit.stable_key,'name',v_unit.name,'horizon',v_unit.horizon),
    'thesis',to_jsonb(v_row)
  );
end;
$function$;

create or replace function atlas.principal_upsert_attention_policy_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_unit atlas.portfolio_units%rowtype;
  v_subject atlas.attention_subjects%rowtype;
  v_policy atlas.attention_policies%rowtype;
  v_subject_key text;
  v_subject_title text;
  v_subject_type text;
  v_policy_key text;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Attention policy input must be an object.' using errcode='22023'; end if;

  v_subject_key:=nullif(btrim(p_input->>'subjectStableKey'),'');
  v_subject_title:=nullif(btrim(p_input->>'subjectTitle'),'');
  v_subject_type:=nullif(btrim(p_input->>'subjectType'),'');
  v_policy_key:=nullif(btrim(p_input->>'policyStableKey'),'');
  if v_subject_key is null or v_subject_title is null or v_subject_type is null or v_policy_key is null then
    raise exception 'subjectStableKey, subjectTitle, subjectType, and policyStableKey are required.' using errcode='22023';
  end if;
  if nullif(p_input->>'cadenceDays','') is null
     or nullif(p_input->>'firstDueAt','') is null
     or nullif(p_input->>'protectedOwnerMinutes','') is null
     or nullif(p_input->>'floorClass','') is null
     or nullif(p_input->>'protectionLevel','') is null
     or nullif(btrim(p_input->>'consequence'),'') is null
     or nullif(btrim(p_input->>'reasonForFloor'),'') is null then
    raise exception 'cadenceDays, firstDueAt, protectedOwnerMinutes, floorClass, protectionLevel, consequence, and reasonForFloor are required.' using errcode='22023';
  end if;

  if nullif(p_input->>'portfolioUnitStableKey','') is not null then
    select * into v_unit
    from atlas.portfolio_units u
    where u.owner_id=v_principal_id
      and u.stable_key=p_input->>'portfolioUnitStableKey'
      and u.archived_at is null;
    if v_unit.id is null then raise exception 'Portfolio unit not found for this Principal.' using errcode='P0002'; end if;
  elsif v_subject_type='portfolio_unit' then
    raise exception 'portfolioUnitStableKey is required for a portfolio_unit attention subject.' using errcode='22023';
  end if;

  insert into atlas.attention_subjects(
    principal_id,portfolio_unit_id,stable_key,subject_type,title,active,source,metadata
  ) values (
    v_principal_id,v_unit.id,v_subject_key,v_subject_type,v_subject_title,true,
    coalesce(nullif(p_input->>'source',''),'principal_authoring'),
    (case when jsonb_typeof(p_input->'subjectMetadata')='object' then p_input->'subjectMetadata' else '{}'::jsonb end)
      || jsonb_build_object('authoringContract','principal_upsert_attention_policy_api_v1')
  )
  on conflict (principal_id,stable_key) do update set
    portfolio_unit_id=excluded.portfolio_unit_id,
    subject_type=excluded.subject_type,
    title=excluded.title,
    active=true,
    source=excluded.source,
    metadata=atlas.attention_subjects.metadata||excluded.metadata,
    updated_at=now()
  returning * into v_subject;

  insert into atlas.attention_policies(
    subject_id,stable_key,cadence_days,first_due_at,protected_owner_minutes,floor_class,
    protection_level,interruptibility,consequence,reason_for_floor,effective_from,effective_through,
    active,source,metadata
  ) values (
    v_subject.id,v_policy_key,(p_input->>'cadenceDays')::integer,(p_input->>'firstDueAt')::timestamptz,
    (p_input->>'protectedOwnerMinutes')::integer,(p_input->>'floorClass')::smallint,p_input->>'protectionLevel',
    coalesce(nullif(p_input->>'interruptibility',''),'low_interruptibility'),p_input->>'consequence',p_input->>'reasonForFloor',
    coalesce(nullif(p_input->>'effectiveFrom','')::timestamptz,now()),
    case when nullif(p_input->>'effectiveThrough','') is null then null else (p_input->>'effectiveThrough')::timestamptz end,
    true,coalesce(nullif(p_input->>'source',''),'principal_authoring'),
    (case when jsonb_typeof(p_input->'policyMetadata')='object' then p_input->'policyMetadata' else '{}'::jsonb end)
      || jsonb_build_object('authoringContract','principal_upsert_attention_policy_api_v1')
  )
  on conflict (subject_id,stable_key) do update set
    cadence_days=excluded.cadence_days,
    first_due_at=excluded.first_due_at,
    protected_owner_minutes=excluded.protected_owner_minutes,
    floor_class=excluded.floor_class,
    protection_level=excluded.protection_level,
    interruptibility=excluded.interruptibility,
    consequence=excluded.consequence,
    reason_for_floor=excluded.reason_for_floor,
    effective_from=excluded.effective_from,
    effective_through=excluded.effective_through,
    active=true,
    source=excluded.source,
    metadata=atlas.attention_policies.metadata||excluded.metadata,
    updated_at=now()
  returning * into v_policy;

  return jsonb_build_object(
    'contractVersion','principal_attention_policy_authoring_v1',
    'subject',to_jsonb(v_subject),
    'policy',to_jsonb(v_policy),
    'attentionState',(select to_jsonb(a) from atlas.attention_debt_v1 a where a.policy_id=v_policy.id)
  );
end;
$function$;

create or replace function atlas.principal_record_attention_event_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_subject atlas.attention_subjects%rowtype;
  v_event atlas.attention_events%rowtype;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  v_principal_id:=atlas.current_principal_id_v1();
  if v_principal_id is null then raise exception 'Active Principal context required.' using errcode='42501'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception 'Attention event input must be an object.' using errcode='22023'; end if;

  select * into v_subject
  from atlas.attention_subjects s
  where s.principal_id=v_principal_id and s.stable_key=p_input->>'subjectStableKey' and s.active;
  if v_subject.id is null then raise exception 'Attention subject not found for this Principal.' using errcode='P0002'; end if;

  insert into atlas.attention_events(subject_id,occurred_at,event_kind,meaningful,minutes,notes,source,metadata)
  values (
    v_subject.id,
    coalesce(nullif(p_input->>'occurredAt','')::timestamptz,now()),
    coalesce(nullif(p_input->>'eventKind',''),'review'),
    coalesce((p_input->>'meaningful')::boolean,true),
    case when nullif(p_input->>'minutes','') is null then null else (p_input->>'minutes')::integer end,
    nullif(p_input->>'notes',''),
    coalesce(nullif(p_input->>'source',''),'principal_authoring'),
    (case when jsonb_typeof(p_input->'metadata')='object' then p_input->'metadata' else '{}'::jsonb end)
      || jsonb_build_object('authoringContract','principal_record_attention_event_api_v1')
  )
  returning * into v_event;

  return jsonb_build_object(
    'contractVersion','principal_attention_event_authoring_v1',
    'event',to_jsonb(v_event),
    'attentionState',(select to_jsonb(a) from atlas.attention_debt_v1 a where a.subject_id=v_subject.id order by a.next_due_at limit 1)
  );
end;
$function$;

revoke all on function atlas.principal_upsert_portfolio_thesis_api_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function atlas.principal_upsert_attention_policy_api_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function atlas.principal_record_attention_event_api_v1(jsonb) from public, anon, authenticated, service_role;
grant execute on function atlas.principal_upsert_portfolio_thesis_api_v1(jsonb) to authenticated, service_role, postgres;
grant execute on function atlas.principal_upsert_attention_policy_api_v1(jsonb) to authenticated, service_role, postgres;
grant execute on function atlas.principal_record_attention_event_api_v1(jsonb) to authenticated, service_role, postgres;

comment on view atlas.attention_debt_v1 is
'Institutional memory for quiet Principal responsibilities. Debt is elapsed time since an explicitly anchored attention cadence became due; it is not a guilt score and creates no cadence by inference.';
comment on table atlas.portfolio_theses is
'Explicit Principal-authored portfolio thesis. Thesis, horizon, value logic, assumptions, and reconsideration conditions are not inferred from task volume.';