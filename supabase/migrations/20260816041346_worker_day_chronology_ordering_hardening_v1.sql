-- Pass 3E release hardening — chronology display order must follow actual/proposed time.
-- Preserve the original 3D selection order separately as selectionIndex.

create or replace function atlas.worker_day_chronology_ordered_v1(
  p_timeline jsonb,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_timeline jsonb:=coalesce(p_timeline,'{}'::jsonb);
  v_day date:=coalesce(p_day,nullif(v_timeline->>'serviceDate','')::date);
  v_timezone text:=coalesce(nullif(v_timeline#>>'{dayShape,timezone}',''),'America/Chicago');
  v_items jsonb:='[]'::jsonb;
begin
  if v_day is null then
    raise exception 'A service date is required to order Worker Day chronology.' using errcode='22023';
  end if;

  with expanded as (
    select
      item.value,
      item.ordinality,
      coalesce((item.value->>'sequenceIndex')::bigint,item.ordinality::bigint) as selection_index,
      coalesce(
        nullif(item.value->>'startsAt','')::timestamptz,
        case coalesce(item.value->>'dayWindow','')
          when 'morning' then ((v_day::timestamp + time '12:00') at time zone v_timezone) - interval '1 microsecond'
          when 'afternoon' then ((v_day::timestamp + time '17:00') at time zone v_timezone) - interval '1 microsecond'
          when 'evening' then (((v_day+1)::timestamp) at time zone v_timezone) - interval '1 microsecond'
          else (((v_day+1)::timestamp) at time zone v_timezone)
        end
      ) as chronology_sort_at
    from jsonb_array_elements(coalesce(v_timeline->'items','[]'::jsonb)) with ordinality item(value,ordinality)
  ), ranked as (
    select
      expanded.*,
      row_number() over(
        order by expanded.chronology_sort_at,expanded.selection_index,coalesce(expanded.value->>'taskId','')
      )::bigint as chronology_index
    from expanded
  )
  select coalesce(jsonb_agg(
    ranked.value || jsonb_build_object(
      'selectionIndex',ranked.selection_index,
      'sequenceIndex',ranked.chronology_index
    )
    order by ranked.chronology_index
  ),'[]'::jsonb)
  into v_items
  from ranked;

  return jsonb_set(v_timeline,'{items}',v_items,true);
end;
$$;

revoke all on function atlas.worker_day_chronology_ordered_v1(jsonb,date) from public,anon,authenticated;
grant execute on function atlas.worker_day_chronology_ordered_v1(jsonb,date) to service_role;

create or replace function atlas.owner_worker_day_plan_choreographed_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_plan jsonb;
  v_timeline jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.user_id=auth.uid() and fm.farm_id=p_farm_id and fm.active=true and fm.role='owner') then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  v_plan:=atlas.worker_day_selection_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=atlas.enrich_worker_day_plan_clock_capacity_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_timeline:=atlas.worker_day_chronology_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=jsonb_set(v_plan,'{clockTimeline}',atlas.worker_day_chronology_ordered_v1(v_timeline,p_day),true);
  return v_plan;
end;
$$;

create or replace function atlas.worker_self_day_plan_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_plan jsonb;
  v_timeline jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if p_day is null then raise exception 'A worker day is required.' using errcode='22023'; end if;
  if not exists(select 1 from atlas.farm_memberships membership where membership.id=p_membership_id and membership.farm_id=p_farm_id
    and membership.user_id=auth.uid() and membership.active=true and membership.role='farm_hand') then
    raise exception 'The Farm Hand Worker Day plan may only be read by that active Farm Hand.' using errcode='42501';
  end if;
  v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  v_plan:=atlas.worker_day_selection_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=atlas.enrich_worker_day_plan_clock_capacity_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=jsonb_set(v_plan,'{suggestions}','[]'::jsonb,true);
  v_timeline:=atlas.worker_day_chronology_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=jsonb_set(v_plan,'{clockTimeline}',atlas.worker_day_chronology_ordered_v1(v_timeline,p_day),true);
  v_plan:=jsonb_set(v_plan,'{contractVersion}',to_jsonb('worker_self_day_plan_v1'::text),true);
  return v_plan;
end;
$$;

revoke all on function atlas.owner_worker_day_plan_choreographed_api_v1(uuid,uuid,date) from public,anon;
grant execute on function atlas.owner_worker_day_plan_choreographed_api_v1(uuid,uuid,date) to authenticated,service_role;
revoke all on function atlas.worker_self_day_plan_api_v1(uuid,uuid,date) from public,anon;
grant execute on function atlas.worker_self_day_plan_api_v1(uuid,uuid,date) to authenticated,service_role;