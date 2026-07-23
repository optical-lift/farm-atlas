create or replace function atlas.tending_board_v1(
  p_farm_id uuid,
  p_worker_key text default null,
  p_due_through date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_role text;
  v_membership_id uuid;
  v_worker_key text;
  v_requested_worker_key text:=nullif(lower(btrim(p_worker_key)),'');
  v_result jsonb;
begin
  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership_id:=atlas.current_membership_id(p_farm_id);
  if v_role is null or v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select nullif(lower(btrim(fm.worker_key)),'') into v_worker_key
  from atlas.farm_memberships fm
  where fm.id=v_membership_id and fm.farm_id=p_farm_id and fm.active=true;

  if v_worker_key is null then
    raise exception 'Current Atlas worker identity was not found.' using errcode='P0002';
  end if;
  if v_requested_worker_key is not null and v_requested_worker_key is distinct from v_worker_key then
    raise exception 'Tending may only load the signed-in membership.' using errcode='42501';
  end if;

  with visible as (
    select x.*
    from atlas.tending_task_track_v1 x
    where x.farm_id=p_farm_id
      and x.task_status='open'
      and x.released_at is not null
      and x.planned_occurrence_id is not null
      and (p_due_through is null or x.due_date is null or x.due_date<=p_due_through)
      and (
        x.visibility_scope='farm_shared'
        or (x.visibility_scope='assigned_worker' and x.assigned_membership_id=v_membership_id)
        or (v_role='owner' and x.visibility_scope='owner' and (x.assigned_membership_id is null or x.assigned_membership_id=v_membership_id))
      )
      and x.gate_key in ('weed','clear','sow','plant','transplant','pot_up','harden_off','germination_check','observe','pinch','water','support','thin','prune','harvest_watch','harvest')
      and (x.object_type in ('bed','row','plot','container','tray','grow_bag') or x.object_mode='annual_production')
      and coalesce(x.care_state,'unknown') not in ('resting','suppressed')
      and not (x.gate_key in ('weed','clear') and coalesce(x.ordinary_weeding_allowed,true)=false)
  ), ranked as (
    select x.*,row_number() over (
      partition by x.object_id
      order by
        x.due_date nulls last,
        case x.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
        x.task_created_at,
        x.task_id
    ) as bed_rank
    from visible x
  ), prepared as (
    select x.*,atlas.tending_gates_v1(
      x.object_id,x.crop_cycle_id,x.task_id,x.expected_harvest_watch_start
    ) as gates
    from ranked x
    where x.bed_rank=1
  ), cards as (
    select x.*,atlas.tending_card_json_v2(x.task_id,x.object_id,x.gates,true) as card
    from prepared x
  )
  select jsonb_build_object(
    'generatedAt',now(),
    'miniGamesEnabled',false,
    'actionableCount',count(*)::integer,
    'bedCount',count(distinct object_id)::integer,
    'nextHarvestOn',min(expected_harvest_watch_start),
    'cards',coalesce(jsonb_agg(card order by
      case section_key when 'harvest_now' then 0 when 'unlock_next' then 1 when 'protect_harvests' then 2 else 3 end,
      due_date nulls last,
      zone_sort_order,
      object_sort_order,
      object_label
    ),'[]'::jsonb)
  ) into v_result
  from cards;

  return coalesce(v_result,jsonb_build_object(
    'generatedAt',now(),
    'miniGamesEnabled',false,
    'actionableCount',0,
    'bedCount',0,
    'cards','[]'::jsonb
  ));
end
$function$;

create or replace function atlas.tending_bed_v1(
  p_farm_id uuid,
  p_object_key text,
  p_worker_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_role text;
  v_membership_id uuid;
  v_worker_key text;
  v_requested_worker_key text:=nullif(lower(btrim(p_worker_key)),'');
  v_object_id uuid;
  v_task_id uuid;
  v_cycle_id uuid;
  v_harvest_on date;
  v_gates jsonb;
  v_card jsonb;
  v_fallback jsonb;
begin
  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership_id:=atlas.current_membership_id(p_farm_id);
  if v_role is null or v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select nullif(lower(btrim(fm.worker_key)),'') into v_worker_key
  from atlas.farm_memberships fm
  where fm.id=v_membership_id and fm.farm_id=p_farm_id and fm.active=true;
  if v_worker_key is null then raise exception 'Current Atlas worker identity was not found.' using errcode='P0002'; end if;
  if v_requested_worker_key is not null and v_requested_worker_key is distinct from v_worker_key then
    raise exception 'Tending may only load the signed-in membership.' using errcode='42501';
  end if;

  select go.id into v_object_id
  from atlas.growing_objects go
  where go.farm_id=p_farm_id and go.stable_key=p_object_key;
  if v_object_id is null then raise exception 'Tending bed not found.' using errcode='P0002'; end if;

  select x.task_id,x.crop_cycle_id,x.expected_harvest_watch_start
  into v_task_id,v_cycle_id,v_harvest_on
  from atlas.tending_task_track_v1 x
  where x.farm_id=p_farm_id
    and x.object_id=v_object_id
    and x.task_status='open'
    and x.released_at is not null
    and x.planned_occurrence_id is not null
    and (
      x.visibility_scope='farm_shared'
      or (x.visibility_scope='assigned_worker' and x.assigned_membership_id=v_membership_id)
      or (v_role='owner' and x.visibility_scope='owner' and (x.assigned_membership_id is null or x.assigned_membership_id=v_membership_id))
    )
    and x.gate_key in ('weed','clear','sow','plant','transplant','pot_up','harden_off','germination_check','observe','pinch','water','support','thin','prune','harvest_watch','harvest')
    and coalesce(x.care_state,'unknown') not in ('resting','suppressed')
    and not (x.gate_key in ('weed','clear') and coalesce(x.ordinary_weeding_allowed,true)=false)
  order by
    x.due_date nulls last,
    case x.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
    x.task_created_at
  limit 1;

  if v_task_id is not null then
    v_gates:=atlas.tending_gates_v1(v_object_id,v_cycle_id,v_task_id,v_harvest_on);
    v_card:=atlas.tending_card_json_v2(v_task_id,v_object_id,v_gates,true);
    return jsonb_build_object('miniGamesEnabled',false,'bed',v_card);
  end if;

  select jsonb_strip_nulls(jsonb_build_object(
    'bedKey',go.stable_key,
    'bedLabel',go.label,
    'zoneKey',z.stable_key,
    'zoneLabel',z.label,
    'objectType',go.object_type,
    'objectMode',go.object_mode,
    'cropCycleId',cc.id,
    'cropLabel',coalesce(nullif(cc.variety,''),cc.crop_label),
    'cropStage',cc.cycle_state,
    'cropLifecycleStatus',cc.lifecycle_status,
    'harvestMetricType',case
      when coalesce(cp.harvest_pattern,cc.metadata->>'harvest_pattern') in ('single_cut','seasonal_single_flush') then 'harvest'
      when coalesce(cp.harvest_pattern,cc.metadata->>'harvest_pattern') in ('cut_and_come_again','repeat_pick','seasonal_repeat_cut') then 'harvest_rounds'
      else 'harvest_opportunities'
    end,
    'firstOrNextHarvestOn',cc.expected_harvest_watch_start,
    'harvestWindowEndsOn',cc.expected_harvest_watch_end,
    'clockBasis',case when cc.sown_date is not null or cc.planted_date is not null then 'confirmed' else 'forecast' end,
    'sownOn',cc.sown_date,
    'plantedOn',cc.planted_date,
    'gates',atlas.tending_gates_v1(go.id,cc.id,null,cc.expected_harvest_watch_start),
    'remainingGateCount',(
      select count(*)::integer
      from jsonb_array_elements(atlas.tending_gates_v1(go.id,cc.id,null,cc.expected_harvest_watch_start)) gate
      where gate->>'status' not in ('complete','skipped')
    ),
    'unlockLabel',coalesce(nullif(cc.variety,''),cc.crop_label),
    'requiresObservation',false,
    'isActionableNow',false,
    'sectionKey',case when cc.lifecycle_status='planned' then 'unlock_next' else 'protect_harvests' end,
    'miniGame',null
  )) into v_fallback
  from atlas.growing_objects go
  left join atlas.zones z on z.id=go.zone_id
  join lateral (
    select cycle.*
    from atlas.crop_cycles cycle
    where cycle.farm_id=p_farm_id
      and cycle.object_id=go.id
      and cycle.lifecycle_status in ('active','planned')
    order by
      case when cycle.lifecycle_status='active' then 0 else 1 end,
      cycle.expected_harvest_watch_start nulls last,
      cycle.created_at desc
    limit 1
  ) cc on true
  left join atlas.crop_profiles cp on cp.id=cc.crop_profile_id
  where go.id=v_object_id;

  if v_fallback is null then
    raise exception 'No active or planned crop track exists for this place.' using errcode='P0002';
  end if;
  return jsonb_build_object('miniGamesEnabled',false,'bed',v_fallback);
end
$function$;

create or replace function atlas.tending_task_context_v2(
  p_farm_id uuid,
  p_task_id uuid,
  p_object_key text,
  p_worker_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_role text;
  v_membership_id uuid;
  v_worker_key text;
  v_requested_worker_key text:=nullif(lower(btrim(p_worker_key)),'');
  v_row atlas.tending_task_track_v1%rowtype;
  v_gates jsonb;
begin
  v_role:=atlas.current_farm_role(p_farm_id);
  v_membership_id:=atlas.current_membership_id(p_farm_id);
  if v_role is null or v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select nullif(lower(btrim(fm.worker_key)),'') into v_worker_key
  from atlas.farm_memberships fm
  where fm.id=v_membership_id and fm.farm_id=p_farm_id and fm.active=true;
  if v_worker_key is null then raise exception 'Current Atlas worker identity was not found.' using errcode='P0002'; end if;
  if v_requested_worker_key is not null and v_requested_worker_key is distinct from v_worker_key then
    raise exception 'Tending may only load the signed-in membership.' using errcode='42501';
  end if;

  select x.* into v_row
  from atlas.tending_task_track_v1 x
  where x.farm_id=p_farm_id
    and x.task_id=p_task_id
    and x.object_key=p_object_key
    and x.task_status<>'archived'
    and (
      x.visibility_scope='farm_shared'
      or (x.visibility_scope='assigned_worker' and x.assigned_membership_id=v_membership_id)
      or (v_role='owner' and x.visibility_scope='owner' and (x.assigned_membership_id is null or x.assigned_membership_id=v_membership_id))
    )
  limit 1;

  if v_row.task_id is null then
    raise exception 'Tending task context not found.' using errcode='P0002';
  end if;

  v_gates:=atlas.tending_gates_v1(
    v_row.object_id,
    v_row.crop_cycle_id,
    v_row.task_id,
    v_row.expected_harvest_watch_start
  );

  return jsonb_build_object(
    'miniGamesEnabled',false,
    'bed',atlas.tending_card_json_v2(
      v_row.task_id,
      v_row.object_id,
      v_gates,
      v_row.task_status='open' and v_row.released_at is not null
    )
  );
end
$function$;

revoke all on function atlas.tending_board_v1(uuid,text,date) from public,anon;
revoke all on function atlas.tending_bed_v1(uuid,text,text) from public,anon;
revoke all on function atlas.tending_task_context_v2(uuid,uuid,text,text) from public,anon;
grant execute on function atlas.tending_board_v1(uuid,text,date) to authenticated;
grant execute on function atlas.tending_bed_v1(uuid,text,text) to authenticated;
grant execute on function atlas.tending_task_context_v2(uuid,uuid,text,text) to authenticated;

comment on function atlas.tending_board_v1(uuid,text,date) is
  'Membership-scoped Tending board: one current released canonical task per productive object; inactive objects are omitted.';
comment on function atlas.tending_bed_v1(uuid,text,text) is
  'Membership-scoped harvest-first bed game board with canonical task gates and no active mini-game layer.';
comment on function atlas.tending_task_context_v2(uuid,uuid,text,text) is
  'Bed-specific harvest context for a canonical task opened from Tending.';
