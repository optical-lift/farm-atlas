create or replace function atlas.worker_day_temporal_mode_v1(
  p_farm_id uuid,
  p_day date
)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_timezone text := 'America/Chicago';
  v_today date;
begin
  if p_day is null then
    raise exception 'Worker day is required.' using errcode='22023';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
    into v_timezone
  from atlas.farms f
  where f.id=p_farm_id;

  v_today := (now() at time zone coalesce(v_timezone,'America/Chicago'))::date;

  if p_day < v_today then return 'historical'; end if;
  if p_day > v_today then return 'future'; end if;
  return 'live';
end;
$function$;

create or replace function atlas.worker_day_selection_overlay_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_plan jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_mode text;
  v_plan jsonb := coalesce(p_plan,'{}'::jsonb);
begin
  v_mode := atlas.worker_day_temporal_mode_v1(p_farm_id,p_day);

  if v_mode='historical' or coalesce((v_plan->>'historicalDay')::boolean,false) then
    return jsonb_set(
      jsonb_set(v_plan,'{nextUp}','[]'::jsonb,true),
      '{suggestions}','[]'::jsonb,true
    );
  end if;

  if v_mode='future' then
    -- Future calendar browsing is a projection, not simulated passage of time.
    -- Preserve exact-date work, explicit placements, and automatic queue/rhythm
    -- continuations already produced by the future planner. Never run the live
    -- selector against today's still-open state.
    v_plan := jsonb_set(v_plan,'{nextUp}','[]'::jsonb,true);
    v_plan := jsonb_set(v_plan,'{futureDay}',to_jsonb(true),true);
    v_plan := jsonb_set(v_plan,'{temporalMode}',to_jsonb('future'::text),true);
    v_plan := jsonb_set(v_plan,'{selectionContractVersion}',to_jsonb('worker_day_future_projection_v1'::text),true);
    return v_plan;
  end if;

  v_plan := atlas.worker_day_selection_overlay_live_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan := jsonb_set(v_plan,'{temporalMode}',to_jsonb('live'::text),true);
  return v_plan;
end;
$function$;
