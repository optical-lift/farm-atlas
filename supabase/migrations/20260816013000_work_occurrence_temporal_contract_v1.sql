-- Pass 3B: add a typed lawful-time contract to the existing durable obligation.
--
-- These fields describe when the work may lawfully/biologically happen.
-- They are deliberately separate from:
--   * planned_due_date: the obligation's planning/target date;
--   * not_before_date: the RELEASE horizon/gate date;
--   * tasks.due_date: downstream operational scheduling state.
--
-- Unknown lawful bounds remain NULL. We do not manufacture a hard deadline from a
-- target date, a release horizon, or a moved executable-task due date.

alter table atlas.planned_work_occurrences
  add column if not exists earliest_lawful_date date,
  add column if not exists preferred_start_date date,
  add column if not exists preferred_end_date date,
  add column if not exists latest_lawful_date date,
  add column if not exists hard_finish_date date,
  add column if not exists miss_consequence jsonb not null default '{}'::jsonb,
  add column if not exists temporal_contract_source text,
  add column if not exists temporal_contract_updated_at timestamptz;

alter table atlas.planned_work_occurrences
  drop constraint if exists planned_work_occurrences_miss_consequence_object_check,
  drop constraint if exists planned_work_occurrences_lawful_window_order_check,
  drop constraint if exists planned_work_occurrences_preferred_window_order_check,
  drop constraint if exists planned_work_occurrences_preferred_after_earliest_check,
  drop constraint if exists planned_work_occurrences_preferred_before_latest_check,
  drop constraint if exists planned_work_occurrences_hard_finish_after_earliest_check,
  drop constraint if exists planned_work_occurrences_latest_before_hard_finish_check,
  drop constraint if exists planned_work_occurrences_preferred_before_hard_finish_check;

alter table atlas.planned_work_occurrences
  add constraint planned_work_occurrences_miss_consequence_object_check
    check (jsonb_typeof(miss_consequence)='object'),
  add constraint planned_work_occurrences_lawful_window_order_check
    check (
      earliest_lawful_date is null
      or latest_lawful_date is null
      or latest_lawful_date >= earliest_lawful_date
    ),
  add constraint planned_work_occurrences_preferred_window_order_check
    check (
      preferred_start_date is null
      or preferred_end_date is null
      or preferred_end_date >= preferred_start_date
    ),
  add constraint planned_work_occurrences_preferred_after_earliest_check
    check (
      earliest_lawful_date is null
      or (
        (preferred_start_date is null or preferred_start_date >= earliest_lawful_date)
        and (preferred_end_date is null or preferred_end_date >= earliest_lawful_date)
      )
    ),
  add constraint planned_work_occurrences_preferred_before_latest_check
    check (
      latest_lawful_date is null
      or (
        (preferred_start_date is null or preferred_start_date <= latest_lawful_date)
        and (preferred_end_date is null or preferred_end_date <= latest_lawful_date)
      )
    ),
  add constraint planned_work_occurrences_hard_finish_after_earliest_check
    check (
      earliest_lawful_date is null
      or hard_finish_date is null
      or hard_finish_date >= earliest_lawful_date
    ),
  add constraint planned_work_occurrences_latest_before_hard_finish_check
    check (
      latest_lawful_date is null
      or hard_finish_date is null
      or latest_lawful_date <= hard_finish_date
    ),
  add constraint planned_work_occurrences_preferred_before_hard_finish_check
    check (
      hard_finish_date is null
      or (
        (preferred_start_date is null or preferred_start_date <= hard_finish_date)
        and (preferred_end_date is null or preferred_end_date <= hard_finish_date)
      )
    );

comment on column atlas.planned_work_occurrences.not_before_date is
  'Release eligibility/horizon date. This is NOT the earliest lawful execution date. A long release horizon may make this years earlier than the work may actually be performed.';

comment on column atlas.planned_work_occurrences.planned_due_date is
  'Planning/target date for the durable obligation. This is NOT automatically a latest-lawful date or hard finish deadline.';

comment on column atlas.planned_work_occurrences.earliest_lawful_date is
  'Earliest date on which execution is lawful/biologically permissible when the upstream source actually defines such a bound. NULL means unknown/unbounded by this contract, not today.';

comment on column atlas.planned_work_occurrences.preferred_start_date is
  'Start of the preferred execution window when upstream truth defines one. Preference does not itself make dates outside this window unlawful.';

comment on column atlas.planned_work_occurrences.preferred_end_date is
  'End of the preferred execution window when upstream truth defines one. Preference does not itself make dates outside this window unlawful.';

comment on column atlas.planned_work_occurrences.latest_lawful_date is
  'Latest date on which execution remains lawful/biologically valid when upstream truth defines one. NULL means unknown/unbounded by this contract.';

comment on column atlas.planned_work_occurrences.hard_finish_date is
  'Hard completion boundary when upstream truth defines one. Never inferred merely from planned_due_date or tasks.due_date.';

comment on column atlas.planned_work_occurrences.miss_consequence is
  'Structured upstream consequence if the lawful/preferred timing is missed. Empty object means consequence is not yet canonically known.';

comment on column atlas.planned_work_occurrences.temporal_contract_source is
  'Canonical source/version that supplied the typed lawful-time contract. Required when the replacement helper writes any non-empty temporal contract.';

comment on column atlas.planned_work_occurrences.temporal_contract_updated_at is
  'When the typed lawful-time contract was last replaced from an authoritative source.';

create or replace function atlas.work_occurrence_temporal_contract_v1(
  p_occurrence_id uuid,
  p_service_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_policy atlas.work_release_policies%rowtype;
  v_service_date date;
  v_timezone text := 'America/Chicago';
  v_upper_bound date;
  v_has_any_legal_bound boolean;
  v_fully_bounded boolean;
  v_lawful boolean;
  v_flexibility text;
  v_conflicts jsonb := '[]'::jsonb;
  v_succession atlas.production_successions%rowtype;
  v_plan atlas.production_plans%rowtype;
begin
  select occurrence.*
  into v_occurrence
  from atlas.planned_work_occurrences occurrence
  where occurrence.id=p_occurrence_id;

  if v_occurrence.id is null then
    raise exception 'Planned work occurrence was not found.' using errcode='P0002';
  end if;

  select policy.*
  into v_policy
  from atlas.work_release_policies policy
  where policy.id=v_occurrence.release_policy_id;

  if v_policy.id is null then
    raise exception 'Work occurrence release policy was not found.' using errcode='55000';
  end if;

  if auth.uid() is not null and not exists (
    select 1
    from atlas.farm_memberships membership
    where membership.farm_id=v_occurrence.farm_id
      and membership.user_id=auth.uid()
      and membership.active=true
  ) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select coalesce(nullif(farm.metadata->>'timezone',''),'America/Chicago')
  into v_timezone
  from atlas.farms farm
  where farm.id=v_occurrence.farm_id;

  v_service_date:=coalesce(
    p_service_date,
    (now() at time zone coalesce(v_timezone,'America/Chicago'))::date
  );
  v_upper_bound:=coalesce(v_occurrence.latest_lawful_date,v_occurrence.hard_finish_date);
  v_has_any_legal_bound:=
    v_occurrence.earliest_lawful_date is not null
    or v_occurrence.latest_lawful_date is not null
    or v_occurrence.hard_finish_date is not null;
  v_fully_bounded:=v_occurrence.earliest_lawful_date is not null and v_upper_bound is not null;

  -- Tri-state legality:
  --   false = a known lawful bound is violated;
  --   true  = both lower and upper bounds are known and the date is inside them;
  --   null  = the contract does not know enough to prove the date lawful or unlawful.
  if v_occurrence.earliest_lawful_date is not null and v_service_date < v_occurrence.earliest_lawful_date then
    v_lawful:=false;
  elsif v_occurrence.latest_lawful_date is not null and v_service_date > v_occurrence.latest_lawful_date then
    v_lawful:=false;
  elsif v_occurrence.hard_finish_date is not null and v_service_date > v_occurrence.hard_finish_date then
    v_lawful:=false;
  elsif v_fully_bounded then
    v_lawful:=true;
  else
    v_lawful:=null;
  end if;

  v_flexibility:=case
    when v_fully_bounded and v_occurrence.earliest_lawful_date=v_upper_bound then 'fixed'
    when v_has_any_legal_bound
      or v_occurrence.preferred_start_date is not null
      or v_occurrence.preferred_end_date is not null then 'bounded_window'
    when v_occurrence.commitment_kind='floating' then 'floating'
    when v_occurrence.commitment_kind='dependency' then 'dependency'
    when v_occurrence.commitment_kind='persistent' then 'persistent'
    when v_occurrence.commitment_kind='hard_date' then 'targeted'
    else 'unspecified'
  end;

  -- Source conflict reporting is observational only. We surface upstream Production
  -- contradictions here; Clock is not allowed to repair them by changing dates.
  if v_occurrence.source_kind='production_succession' and v_occurrence.source_id is not null then
    select succession.*
    into v_succession
    from atlas.production_successions succession
    where succession.id=v_occurrence.source_id;

    if v_succession.id is null then
      v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object(
        'code','production_succession_missing',
        'sourceId',v_occurrence.source_id
      ));
    else
      select plan.*
      into v_plan
      from atlas.production_plans plan
      where plan.id=v_succession.production_plan_id;

      if v_plan.id is null then
        v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object(
          'code','production_plan_missing',
          'sourceId',v_succession.production_plan_id
        ));
      elsif v_plan.final_biological_sow_date is not null then
        if v_succession.planned_window_start > v_plan.final_biological_sow_date then
          v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object(
            'code','production_window_starts_after_final_biological_date',
            'finalBiologicalDate',v_plan.final_biological_sow_date,
            'sourceDate',v_succession.planned_window_start
          ));
        end if;
        if v_succession.planned_window_end > v_plan.final_biological_sow_date then
          v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object(
            'code','production_preferred_window_exceeds_final_biological_date',
            'finalBiologicalDate',v_plan.final_biological_sow_date,
            'sourceDate',v_succession.planned_window_end
          ));
        end if;
        if v_succession.late_window_end > v_plan.final_biological_sow_date then
          v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object(
            'code','production_late_window_exceeds_final_biological_date',
            'finalBiologicalDate',v_plan.final_biological_sow_date,
            'sourceDate',v_succession.late_window_end
          ));
        end if;
        if v_succession.skip_after_date > v_plan.final_biological_sow_date then
          v_conflicts:=v_conflicts||jsonb_build_array(jsonb_build_object(
            'code','production_skip_boundary_exceeds_final_biological_date',
            'finalBiologicalDate',v_plan.final_biological_sow_date,
            'sourceDate',v_succession.skip_after_date
          ));
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','work_occurrence_temporal_contract_v1',
    'occurrenceId',v_occurrence.id,
    'farmId',v_occurrence.farm_id,
    'state',v_occurrence.state,
    'workLane',v_occurrence.work_lane,
    'commitmentKind',v_occurrence.commitment_kind,
    'temporalFlexibility',v_flexibility,
    'serviceDate',v_service_date,

    'plannedDueDate',v_occurrence.planned_due_date,
    'releaseNotBeforeDate',v_occurrence.not_before_date,
    'releaseGateType',v_policy.gate_type,

    'earliestLawfulDate',v_occurrence.earliest_lawful_date,
    'preferredStartDate',v_occurrence.preferred_start_date,
    'preferredEndDate',v_occurrence.preferred_end_date,
    'latestLawfulDate',v_occurrence.latest_lawful_date,
    'hardFinishDate',v_occurrence.hard_finish_date,
    'missConsequence',v_occurrence.miss_consequence,
    'contractSource',v_occurrence.temporal_contract_source,
    'contractUpdatedAt',v_occurrence.temporal_contract_updated_at,

    'legalWindowKnown',v_has_any_legal_bound,
    'legalWindowFullyBounded',v_fully_bounded,
    'lawfulOnServiceDate',v_lawful,
    'hardDeadlineMissed',case
      when v_occurrence.hard_finish_date is null then null
      else v_service_date > v_occurrence.hard_finish_date
    end,
    'sourceConflicts',v_conflicts
  );
end;
$$;

comment on function atlas.work_occurrence_temporal_contract_v1(uuid,date) is
  'Canonical read contract for durable obligation timing. planned_due_date is a target and not_before_date is release timing; neither is promoted into lawful execution bounds. lawfulOnServiceDate is NULL when lawful bounds are insufficiently known.';

create or replace function atlas.replace_work_occurrence_temporal_contract_v1(
  p_occurrence_id uuid,
  p_earliest_lawful_date date default null,
  p_preferred_start_date date default null,
  p_preferred_end_date date default null,
  p_latest_lawful_date date default null,
  p_hard_finish_date date default null,
  p_miss_consequence jsonb default '{}'::jsonb,
  p_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_has_contract boolean;
begin
  select occurrence.*
  into v_occurrence
  from atlas.planned_work_occurrences occurrence
  where occurrence.id=p_occurrence_id
  for update;

  if v_occurrence.id is null then
    raise exception 'Planned work occurrence was not found.' using errcode='P0002';
  end if;

  v_has_contract :=
    p_earliest_lawful_date is not null
    or p_preferred_start_date is not null
    or p_preferred_end_date is not null
    or p_latest_lawful_date is not null
    or p_hard_finish_date is not null
    or coalesce(p_miss_consequence,'{}'::jsonb) <> '{}'::jsonb;

  if v_has_contract and nullif(btrim(coalesce(p_source,'')),'') is null then
    raise exception 'A temporal contract source is required when lawful timing or miss consequence is supplied.'
      using errcode='22023';
  end if;

  if jsonb_typeof(coalesce(p_miss_consequence,'{}'::jsonb)) <> 'object' then
    raise exception 'Miss consequence must be a JSON object.' using errcode='22023';
  end if;

  update atlas.planned_work_occurrences occurrence
  set earliest_lawful_date=p_earliest_lawful_date,
      preferred_start_date=p_preferred_start_date,
      preferred_end_date=p_preferred_end_date,
      latest_lawful_date=p_latest_lawful_date,
      hard_finish_date=p_hard_finish_date,
      miss_consequence=coalesce(p_miss_consequence,'{}'::jsonb),
      temporal_contract_source=nullif(btrim(coalesce(p_source,'')),''),
      temporal_contract_updated_at=case when v_has_contract then now() else null end,
      updated_at=now()
  where occurrence.id=p_occurrence_id
  returning * into v_occurrence;

  return atlas.work_occurrence_temporal_contract_v1(v_occurrence.id,null);
end;
$$;

comment on function atlas.replace_work_occurrence_temporal_contract_v1(uuid,date,date,date,date,date,jsonb,text) is
  'Replaces the typed lawful-time contract from an explicit authoritative source. This helper never infers lawful bounds from occurrence target dates or executable task dates.';

-- Existing rows are intentionally NOT backfilled. Their planning and release dates do
-- not prove lawful execution bounds. Source-adoption passes will populate only rows
-- whose upstream domain can actually establish the contract.

revoke all on function atlas.replace_work_occurrence_temporal_contract_v1(uuid,date,date,date,date,date,jsonb,text) from public, anon, authenticated;
grant execute on function atlas.replace_work_occurrence_temporal_contract_v1(uuid,date,date,date,date,date,jsonb,text) to service_role;

revoke all on function atlas.work_occurrence_temporal_contract_v1(uuid,date) from public, anon;
grant execute on function atlas.work_occurrence_temporal_contract_v1(uuid,date) to authenticated, service_role;
