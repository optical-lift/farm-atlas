create or replace function atlas.worker_weekly_farm_contract_v3(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
declare
  v_base jsonb;
  v_week_start date;
  v_item jsonb;
  v_traits jsonb;
  v_decorated jsonb;
  v_work jsonb:='[]'::jsonb;
  v_required_trait_partial integer:=0;
  v_required_outdoor_heavy_minutes integer:=0;
  v_required_outdoor_light_minutes integer:=0;
  v_required_propagation_minutes integer:=0;
  v_required_venue_minutes integer:=0;
  v_required_admin_minutes integer:=0;
  v_required_morning_minutes integer:=0;
  v_required_afternoon_minutes integer:=0;
  v_required_evening_minutes integer:=0;
  v_required_can_fragment_minutes integer:=0;
  v_required_should_not_fragment_minutes integer:=0;
  v_minutes integer;
  v_required boolean;
  v_keys jsonb;
begin
  v_base:=atlas.worker_weekly_farm_contract_v2(p_farm_id,p_membership_id,p_anchor_day);
  v_week_start:=(v_base->>'weekStart')::date;

  for v_item in
    select value from jsonb_array_elements(coalesce(v_base->'work','[]'::jsonb))
  loop
    v_traits:=atlas.task_clock_function_traits_v1((v_item->>'taskId')::uuid,v_week_start);
    v_decorated:=v_item||jsonb_build_object('clockTraits',v_traits);
    v_work:=v_work||jsonb_build_array(v_decorated);

    v_required:=coalesce((v_item->>'requiredThisWeek')::boolean,false);
    if v_required then
      v_minutes:=coalesce((v_item->>'expectedActiveMinutes')::integer,0);
      v_keys:=coalesce(v_traits->'traitKeys','[]'::jsonb);

      if v_traits->>'state'<>'classified' then
        v_required_trait_partial:=v_required_trait_partial+1;
      end if;
      if v_keys ? 'outdoor_heavy' then
        v_required_outdoor_heavy_minutes:=v_required_outdoor_heavy_minutes+v_minutes;
      end if;
      if v_keys ? 'outdoor_light' then
        v_required_outdoor_light_minutes:=v_required_outdoor_light_minutes+v_minutes;
      end if;
      if v_keys ? 'propagation' then
        v_required_propagation_minutes:=v_required_propagation_minutes+v_minutes;
      end if;
      if v_keys ? 'venue_bounded' then
        v_required_venue_minutes:=v_required_venue_minutes+v_minutes;
      end if;
      if v_keys ? 'farm_admin_call' then
        v_required_admin_minutes:=v_required_admin_minutes+v_minutes;
      end if;
      case v_traits->>'dayWindow'
        when 'morning' then v_required_morning_minutes:=v_required_morning_minutes+v_minutes;
        when 'afternoon' then v_required_afternoon_minutes:=v_required_afternoon_minutes+v_minutes;
        when 'evening' then v_required_evening_minutes:=v_required_evening_minutes+v_minutes;
        else null;
      end case;
      if v_traits->>'fragmentation'='can_fragment' then
        v_required_can_fragment_minutes:=v_required_can_fragment_minutes+v_minutes;
      elsif v_traits->>'fragmentation'='should_not_fragment' then
        v_required_should_not_fragment_minutes:=v_required_should_not_fragment_minutes+v_minutes;
      end if;
    end if;
  end loop;

  return v_base||jsonb_build_object(
    'contractVersion','worker_weekly_farm_contract_v3',
    'clockFunctionalTaxonomyVersion','task_clock_function_traits_v1',
    'clockFunctionalTaxonomyReady',v_required_trait_partial=0,
    'requiredClockTraitPartialCount',v_required_trait_partial,
    'requiredOutdoorHeavyMinutes',v_required_outdoor_heavy_minutes,
    'requiredOutdoorLightMinutes',v_required_outdoor_light_minutes,
    'requiredPropagationMinutes',v_required_propagation_minutes,
    'requiredVenueBoundedMinutes',v_required_venue_minutes,
    'requiredFarmAdminCallMinutes',v_required_admin_minutes,
    'requiredDayWindowMinutes',jsonb_build_object(
      'morning',v_required_morning_minutes,
      'afternoon',v_required_afternoon_minutes,
      'evening',v_required_evening_minutes
    ),
    'requiredFragmentationMinutes',jsonb_build_object(
      'canFragment',v_required_can_fragment_minutes,
      'shouldNotFragment',v_required_should_not_fragment_minutes
    ),
    'work',v_work
  );
end;
$$;

revoke all on function atlas.worker_weekly_farm_contract_v3(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.worker_weekly_farm_contract_v3(uuid,uuid,date) to service_role;

create or replace function atlas.owner_weekly_farm_contract_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  return atlas.worker_weekly_farm_contract_v3(p_farm_id,p_membership_id,p_anchor_day);
end;
$$;

create or replace function atlas.worker_self_weekly_farm_contract_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if not exists(
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id
      and fm.user_id=auth.uid() and fm.active=true and fm.role='farm_hand'
  ) then
    raise exception 'The Weekly Farm Contract may only be read by that active Farm Hand.' using errcode='42501';
  end if;
  return atlas.worker_weekly_farm_contract_v3(p_farm_id,p_membership_id,p_anchor_day);
end;
$$;

revoke all on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated, service_role;
revoke all on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) from public, anon;
grant execute on function atlas.worker_self_weekly_farm_contract_api_v1(uuid,uuid,date) to authenticated, service_role;