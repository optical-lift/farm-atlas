do $$
declare
  v_def text;
  v_original text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='presented_work_selection_rows_v2'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_work_date date';
  if v_def is null then raise exception 'presented_work_selection_rows_v2 was not found'; end if;
  v_original:=v_def;
  v_def:=replace(v_def,'within_reality_governed_capacity','within_day_capacity');
  v_def:=replace(v_def,'next_up_reality_heavy_capacity','next_up_heavy_capacity');
  v_def:=replace(v_def,'next_up_reality_capacity','next_up_capacity');
  if v_def=v_original then raise exception 'Phase 12 capacity reason compatibility rewrite found no expected markers'; end if;
  execute v_def;
end $$;

alter function atlas.presented_work_selection_rows_v1(uuid,uuid,date)
  rename to presented_work_selection_rows_legacy_v1;

comment on function atlas.presented_work_selection_rows_legacy_v1(uuid,uuid,date) is
  'Phase 12 frozen legacy task-centric selector retained only as the comparator/input universe for Farm Clock Reality Candidate v1.';

do $$
declare
  v_def text;
  v_original text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='farm_clock_reality_candidates_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_work_date date';
  if v_def is null then raise exception 'farm_clock_reality_candidates_v1 was not found'; end if;
  v_original:=v_def;
  v_def:=replace(v_def,'atlas.presented_work_selection_rows_v1(','atlas.presented_work_selection_rows_legacy_v1(');
  if v_def=v_original then raise exception 'Farm Clock Reality Candidate did not contain the expected legacy selector dependency'; end if;
  execute v_def;
end $$;

create or replace function atlas.presented_work_selection_rows_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
) returns table(
  task_id uuid,
  presentation_state text,
  presentation_reason text,
  lane_order integer,
  selection_rank bigint,
  work_lane text,
  commitment_kind text,
  effort_units numeric,
  budget_units numeric,
  notification_planned boolean,
  overload boolean
)
language sql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
  select * from atlas.presented_work_selection_rows_v2(p_farm_id,p_membership_id,p_work_date);
$$;

revoke all on function atlas.presented_work_selection_rows_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.presented_work_selection_rows_v1(uuid,uuid,date) to service_role;

create or replace function atlas.presented_work_rows_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
) returns table(
  task_id uuid,
  presentation_state text,
  presentation_reason text,
  lane_order integer,
  selection_rank bigint,
  work_lane text,
  commitment_kind text,
  effort_units numeric,
  budget_units numeric,
  notification_planned boolean,
  overload boolean,
  task_card jsonb
)
language sql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
  with selection as materialized (
    select * from atlas.presented_work_selection_rows_v2(p_farm_id,p_membership_id,p_work_date)
  ), reality as materialized (
    select * from atlas.farm_clock_reality_candidates_v1(p_farm_id,p_membership_id,p_work_date)
  )
  select
    s.task_id,s.presentation_state,s.presentation_reason,s.lane_order,s.selection_rank,
    s.work_lane,s.commitment_kind,s.effort_units,s.budget_units,s.notification_planned,s.overload,
    card.card || jsonb_build_object(
      'sky_timing',atlas.task_sky_presentation_gate_v1(s.task_id,coalesce(p_work_date,(now() at time zone 'America/Chicago')::date)),
      'capacity_deferral',atlas.task_worker_day_deferral_v1(s.task_id,coalesce(p_work_date,(now() at time zone 'America/Chicago')::date)),
      'farm_clock_reality',jsonb_build_object(
        'warrantClass',r.reality_warrant_class,
        'warrantOrder',r.reality_warrant_order,
        'subjectState',r.subject_state,
        'fittingOperation',r.fitting_operation,
        'operationWindow',r.operation_window,
        'claimCapacityContext',r.claim_capacity_context,
        'jurisdiction',r.jurisdiction,
        'truthBoundary',r.truth_boundary
      )
    )
  from selection s
  join reality r on r.task_id=s.task_id
  cross join lateral (
    select to_jsonb(c) as card from atlas.v_task_cards c where c.task_id=s.task_id limit 1
  ) card
  order by s.selection_rank;
$$;

create or replace function atlas.presented_work_rows_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
) returns table(
  task_id uuid,
  presentation_state text,
  presentation_reason text,
  lane_order integer,
  selection_rank bigint,
  work_lane text,
  commitment_kind text,
  effort_units numeric,
  budget_units numeric,
  notification_planned boolean,
  overload boolean,
  task_card jsonb
)
language sql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
  select * from atlas.presented_work_rows_v2(p_farm_id,p_membership_id,p_work_date);
$$;

revoke all on function atlas.presented_work_rows_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.presented_work_rows_v1(uuid,uuid,date) to service_role;

comment on function atlas.presented_work_selection_rows_v1(uuid,uuid,date) is
  'Canonical Farm Clock selector. Phase 12 delegates to Reality-governed v2 while preserving the v1 signature for existing consumers.';
comment on function atlas.presented_work_rows_v1(uuid,uuid,date) is
  'Canonical Farm Clock card stream. Phase 12 delegates to Reality-governed v2 and includes lightweight reality-warrant evidence.';