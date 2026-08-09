begin;

do $$
declare
  v_farm_id uuid;
  v_iris_id uuid;
  v_preferred atlas.sky_operation_rules%rowtype;
  v_strict atlas.sky_operation_rules%rowtype;
begin
  select id into v_farm_id
  from atlas.farms
  where stable_key='elm_farm';

  if v_farm_id is null then
    raise exception 'Elm Farm not found';
  end if;

  select * into v_preferred
  from atlas.sky_operation_rules
  where farm_id=v_farm_id
    and stable_key='elm_divide_reestablish_common_mode_preference_v1'
    and rule_version=1;

  if v_preferred.id is null then
    raise exception 'Preferred divide/re-establish sky rule is missing';
  end if;
  if v_preferred.status <> 'approved' or not v_preferred.active then
    raise exception 'Preferred divide/re-establish sky rule must be approved and active';
  end if;
  if v_preferred.enforcement_mode <> 'preferred' then
    raise exception 'Common-mode iris rule must remain non-blocking Preferred';
  end if;
  if v_preferred.predicate <> '{"moon_mode_in":["common"]}'::jsonb then
    raise exception 'Common-mode iris rule predicate drifted: %', v_preferred.predicate;
  end if;
  if v_preferred.evidence_class <> 'working_reconstruction' then
    raise exception 'Common-mode iris rule evidence class drifted';
  end if;
  if coalesce((v_preferred.metadata->>'worker_withholding_authorized')::boolean,true) then
    raise exception 'Preferred iris rule must not authorize worker withholding';
  end if;
  if v_preferred.predicate ? 'phase_state_in'
     or v_preferred.predicate ? 'illumination_min'
     or v_preferred.predicate ? 'illumination_max' then
    raise exception 'Iris preference must not smuggle Moon-phase doctrine into the rule';
  end if;

  if not atlas.sky_rule_matches_v1(v_preferred.predicate,'{"moonMode":"common"}'::jsonb) then
    raise exception 'Common mode should match the preferred predicate';
  end if;
  if atlas.sky_rule_matches_v1(v_preferred.predicate,'{"moonMode":"moveable"}'::jsonb) then
    raise exception 'Moveable mode must not match the common-mode predicate';
  end if;

  select * into v_strict
  from atlas.sky_operation_rules
  where farm_id=v_farm_id
    and stable_key='elm_iris_division_window_v1'
  order by rule_version desc
  limit 1;

  if v_strict.id is null then
    raise exception 'Strict iris window draft is missing';
  end if;
  if v_strict.status <> 'draft' or v_strict.active then
    raise exception 'Strict iris window must remain inactive draft';
  end if;
  if v_strict.enforcement_mode <> 'windowed' then
    raise exception 'Strict iris draft should preserve its intended windowed semantics while inactive';
  end if;

  select id into v_iris_id
  from atlas.tasks
  where farm_id=v_farm_id
    and metadata->>'task_key'='anna_20260716_divide_lilac_haven_irises_into_drifts';

  if v_iris_id is null then
    raise exception 'Lilac Haven iris task not found';
  end if;
  if not exists (
    select 1 from atlas.tasks
    where id=v_iris_id
      and status='open'
      and operation_class='divide_reestablish_belowground'
      and commitment_kind='floating'
      and due_date is null
  ) then
    raise exception 'Iris task must remain open floating undated divide/re-establish work';
  end if;
end;
$$;

rollback;
