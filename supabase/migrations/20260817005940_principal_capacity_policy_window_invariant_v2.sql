create or replace function atlas.principal_set_capacity_policy_api_v1(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
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
  v_window_minutes integer;
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
  if exists(select 1 from unnest(v_weekdays) d where d < 0 or d > 6) then
    raise exception 'weekdays values must be integers from 0 (Sunday) through 6 (Saturday).' using errcode='22023';
  end if;

  if nullif(p_input->>'localStart','') is null or nullif(p_input->>'localEnd','') is null then
    raise exception 'localStart and localEnd are required.' using errcode='22023';
  end if;
  v_local_start:=(p_input->>'localStart')::time;
  v_local_end:=(p_input->>'localEnd')::time;
  if v_local_end <= v_local_start then
    raise exception 'localEnd must be later than localStart on the same local day.' using errcode='22023';
  end if;
  v_window_minutes:=round(extract(epoch from (v_local_end-v_local_start))/60.0)::integer;

  if nullif(p_input->>'defaultDiscretionaryMinutes','') is null or nullif(p_input->>'maximumPlannedMinutes','') is null then
    raise exception 'defaultDiscretionaryMinutes and maximumPlannedMinutes are required.' using errcode='22023';
  end if;
  v_default:=(p_input->>'defaultDiscretionaryMinutes')::integer;
  v_maximum:=(p_input->>'maximumPlannedMinutes')::integer;
  if v_default < 0 or v_maximum < 0 then
    raise exception 'Capacity minute values cannot be negative.' using errcode='22023';
  end if;
  if v_default > v_maximum then
    raise exception 'defaultDiscretionaryMinutes cannot exceed maximumPlannedMinutes.' using errcode='22023';
  end if;
  if v_maximum > v_window_minutes then
    raise exception 'maximumPlannedMinutes cannot exceed the local capacity window itself.' using errcode='22023';
  end if;

  if nullif(p_input->>'effectiveFrom','') is null then
    raise exception 'effectiveFrom is required.' using errcode='22023';
  end if;
  v_from:=(p_input->>'effectiveFrom')::date;
  v_through:=case when nullif(p_input->>'effectiveThrough','') is null then null else (p_input->>'effectiveThrough')::date end;
  if v_through is not null and v_through < v_from then
    raise exception 'effectiveThrough cannot be earlier than effectiveFrom.' using errcode='22023';
  end if;

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

comment on function atlas.principal_set_capacity_policy_api_v1(jsonb) is
'Authenticated Principal authoring contract for explicit capacity policy. Validates weekday, local-time, minute, and effective-date invariants; maximum planned minutes cannot exceed the local day envelope; never seeds or infers a schedule.';
