create or replace function atlas.mark_worker_weekly_capacity_owner_decision_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_week_start date,
  p_consequence text,
  p_owner_decision_required text,
  p_note text default null,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_conflict jsonb;
  v_path jsonb;
  v_updated integer:=0;
  v_rows integer:=0;
begin
  if p_week_start is null or nullif(btrim(coalesce(p_consequence,'')),'') is null or nullif(btrim(coalesce(p_owner_decision_required,'')),'') is null then
    raise exception 'Week start, ownership consequence, and owner decision required are mandatory.' using errcode='22023';
  end if;
  v_conflict:=atlas.worker_weekly_capacity_conflict_v2(p_farm_id,p_membership_id,p_week_start);
  if v_conflict->>'state'<>'management_conflict' then
    raise exception 'An ownership consequence can only be raised from a current Farm Operations management capacity conflict.' using errcode='55000';
  end if;
  perform atlas.ensure_worker_weekly_capacity_management_v1(p_farm_id,p_membership_id,p_week_start);

  update atlas.tasks t set metadata=t.metadata||jsonb_build_object(
    'ownership_consequence_unresolved',true,'ownership_consequence',btrim(p_consequence),
    'owner_decision_required',btrim(p_owner_decision_required),'management_note',nullif(btrim(coalesce(p_note,'')),''),
    'management_case_state','ownership_consequence_unresolved','management_marked_by',p_actor_user_id,'management_marked_at',now()
  ),updated_at=now()
  where t.farm_id=p_farm_id and t.generated_from='worker_weekly_capacity_management' and t.generated_from_id=p_membership_id
    and t.status in ('open','blocked') and t.metadata->>'week_start'=p_week_start::text;
  get diagnostics v_updated=row_count;

  update atlas.planned_work_occurrences pwo set
    task_payload=jsonb_set(
      coalesce(pwo.task_payload,'{}'::jsonb),'{metadata}',
      coalesce(pwo.task_payload#>'{metadata}','{}'::jsonb)||jsonb_build_object(
        'ownership_consequence_unresolved',true,'ownership_consequence',btrim(p_consequence),
        'owner_decision_required',btrim(p_owner_decision_required),'management_note',nullif(btrim(coalesce(p_note,'')),''),
        'management_case_state','ownership_consequence_unresolved','management_marked_by',p_actor_user_id,'management_marked_at',now()
      ),true
    ),updated_at=now()
  where pwo.farm_id=p_farm_id and pwo.source_kind='worker_weekly_capacity_management' and pwo.source_id=p_membership_id
    and pwo.occurrence_key='worker-weekly-capacity:'||p_membership_id::text||':'||p_week_start::text
    and pwo.state in ('planned','eligible','releasing','released');
  get diagnostics v_rows=row_count;
  v_updated:=v_updated+v_rows;

  if v_updated=0 then raise exception 'Farm Operations capacity management path was not found.' using errcode='P0002'; end if;
  v_path:=atlas.worker_weekly_capacity_management_state_v1(p_farm_id,p_membership_id,p_week_start);
  return jsonb_build_object(
    'contractVersion','management_worker_capacity_owner_decision_v1',
    'state','ownership_consequence_unresolved','managementPath',v_path,
    'principalEscalationWarrant',true,'updatedPathRows',v_updated
  );
end;
$$;
revoke all on function atlas.mark_worker_weekly_capacity_owner_decision_v1(uuid,uuid,date,text,text,text,uuid) from public,anon,authenticated;
grant execute on function atlas.mark_worker_weekly_capacity_owner_decision_v1(uuid,uuid,date,text,text,text,uuid) to service_role;

create or replace function atlas.management_mark_worker_weekly_capacity_owner_decision_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_week_start date,
  p_consequence text,
  p_owner_decision_required text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare v_uid uuid;
begin
  v_uid:=auth.uid();
  if v_uid is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.farm_id=p_farm_id and fm.user_id=v_uid and fm.active=true and fm.role in ('owner','manager')) then
    raise exception 'Active Farm Operations management membership required.' using errcode='42501';
  end if;
  return atlas.mark_worker_weekly_capacity_owner_decision_v1(
    p_farm_id,p_membership_id,p_week_start,p_consequence,p_owner_decision_required,p_note,v_uid
  );
end;
$$;
revoke all on function atlas.management_mark_worker_weekly_capacity_owner_decision_api_v1(uuid,uuid,date,text,text,text) from public,anon;
grant execute on function atlas.management_mark_worker_weekly_capacity_owner_decision_api_v1(uuid,uuid,date,text,text,text) to authenticated,service_role;

create or replace function atlas.sync_worker_weekly_capacity_escalation_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_principal_id uuid;
  v_portfolio_unit_id uuid;
  v_horizon text;
  v_timezone text;
  v_conflict jsonb;
  v_management jsonb;
  v_week_start date;
  v_week_end date;
  v_source_id text;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_recorded jsonb;
begin
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then
    raise exception 'Active Farm Hand membership required.' using errcode='P0002';
  end if;
  select u.owner_id,u.id,u.horizon,coalesce(nullif(f.metadata->>'timezone',''),nullif(p.home_timezone,''),'UTC')
    into v_principal_id,v_portfolio_unit_id,v_horizon,v_timezone
  from atlas.portfolio_units u
  join atlas.principals p on p.id=u.owner_id and p.status='active'
  join atlas.farms f on f.id=p_farm_id and f.status='active'
  where u.linked_farm_id=p_farm_id and u.archived_at is null
  order by u.created_at,u.id limit 1;

  v_conflict:=atlas.worker_weekly_capacity_conflict_v2(p_farm_id,p_membership_id,p_anchor_day);
  v_week_start:=(v_conflict->>'weekStart')::date;
  v_week_end:=(v_conflict->>'weekEnd')::date;
  v_source_id:=p_farm_id::text||':'||p_membership_id::text||':'||v_week_start::text;
  perform atlas.ensure_worker_weekly_capacity_management_v1(p_farm_id,p_membership_id,v_week_start);
  v_management:=atlas.worker_weekly_capacity_management_state_v1(p_farm_id,p_membership_id,v_week_start);

  if v_principal_id is null then
    return jsonb_build_object('contractVersion','principal_farm_capacity_escalation_sync_v2','state','principal_portfolio_mapping_required','farmId',p_farm_id,'membershipId',p_membership_id,'mutated',false);
  end if;

  if v_conflict->>'state'<>'management_conflict' or not coalesce((v_management->>'ownershipConsequenceUnresolved')::boolean,false) then
    update atlas.operational_escalations e set status='resolved',resolved_at=coalesce(e.resolved_at,now()),updated_at=now(),
      metadata=e.metadata||jsonb_build_object('resolutionContract','principal_farm_capacity_escalation_sync_v2','resolutionReason','contained_or_resolved_in_farm_operations','resolvedAt',now(),'farmClockState',v_conflict->>'state')
    where e.principal_id=v_principal_id and e.source_system='farm_clock' and e.source_type='worker_weekly_capacity'
      and e.source_id=v_source_id and e.status in ('open','acknowledged');
    return jsonb_build_object(
      'contractVersion','principal_farm_capacity_escalation_sync_v2','state',v_conflict->>'state','farmId',p_farm_id,'membershipId',p_membership_id,
      'weekStart',v_week_start,'weekEnd',v_week_end,'action','contained_in_farm_operations','managementPath',v_management,
      'principalEscalationWarrant',false,'mutated',true
    );
  end if;

  v_window_start:=v_week_start::timestamp at time zone v_timezone;
  v_window_end:=(v_week_end+1)::timestamp at time zone v_timezone;
  v_recorded:=atlas.record_operational_escalation_v1(v_principal_id,jsonb_build_object(
    'sourceSystem','farm_clock','sourceType','worker_weekly_capacity','sourceId',v_source_id,
    'portfolioUnitStableKey',(select u.stable_key from atlas.portfolio_units u where u.id=v_portfolio_unit_id),
    'escalationKind','capacity_breach','currentState',jsonb_build_object(
      'farmClock',v_conflict,'managementPath',v_management,'managementBoundarySatisfied',true
    ),
    'thresholdCrossed','Farm Operations explicitly determined that a current labor-capacity conflict leaves an ownership-level consequence unresolved.',
    'consequence',coalesce(nullif(v_management->>'consequence',''),'Farm Operations cannot resolve the capacity conflict within delegated authority.'),
    'ownerDecisionRequired',coalesce(nullif(v_management->>'ownerDecisionRequired',''),'Choose an ownership-level change to capacity, scope, deadline, capital, or accepted consequence.'),
    'options',jsonb_build_array('change_capacity','change_scope','change_deadline','allocate_capital','accept_consequence'),
    'severity','material','floorClass',6,
    'protectionLevel',case when coalesce((v_conflict->>'protectedFarmMinimumMinutes')::integer,0)>0 then 'protected' else 'standard' end,
    'interruptibility','interruptible','reasonForFloor','A delegated Farm Operations capacity conflict crossed the Principal boundary only after management explicitly proved an ownership consequence remained unresolved.',
    'windowStart',v_window_start,'windowEnd',v_window_end,'expectedOwnerMinutes',15,'horizon',v_horizon,
    'metadata',jsonb_build_object('syncContract','principal_farm_capacity_escalation_sync_v2','farmId',p_farm_id,'membershipId',p_membership_id,'weekStart',v_week_start,'weekEnd',v_week_end,'managementBoundarySatisfied',true)
  ));

  return jsonb_build_object(
    'contractVersion','principal_farm_capacity_escalation_sync_v2','state',v_conflict->>'state',
    'action','principal_escalation_recorded','principalEscalationWarrant',true,'managementPath',v_management,'result',v_recorded,'mutated',true
  );
end;
$$;
revoke all on function atlas.sync_worker_weekly_capacity_escalation_v2(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.sync_worker_weekly_capacity_escalation_v2(uuid,uuid,date) to service_role;

create or replace function atlas.sync_worker_weekly_capacity_escalation_v1(p_farm_id uuid,p_membership_id uuid,p_anchor_day date default null)
returns jsonb language sql security definer set search_path to 'pg_catalog','atlas','auth' as $$
  select atlas.sync_worker_weekly_capacity_escalation_v2(p_farm_id,p_membership_id,p_anchor_day);
$$;

create or replace function atlas.owner_worker_weekly_capacity_conflict_api_v1(p_farm_id uuid,p_membership_id uuid,p_anchor_day date default null)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog','atlas','auth' as $$
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner farm membership required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then raise exception 'Active Farm Hand membership required.' using errcode='42501'; end if;
  return atlas.worker_weekly_capacity_conflict_v2(p_farm_id,p_membership_id,p_anchor_day);
end;
$$;

create or replace function atlas.tick_worker_weekly_capacity_escalations_v1()
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','atlas','auth' as $$
declare r record; v_result jsonb; v_results jsonb:='[]'::jsonb; v_count integer:=0;
begin
  for r in select distinct fm.farm_id,fm.id membership_id,coalesce(nullif(f.metadata->>'timezone',''),nullif(p.home_timezone,''),'UTC') timezone
    from atlas.farm_memberships fm join atlas.farms f on f.id=fm.farm_id and f.status='active'
    join atlas.portfolio_units u on u.linked_farm_id=fm.farm_id and u.archived_at is null
    join atlas.principals p on p.id=u.owner_id and p.status='active'
    where fm.active=true and fm.role='farm_hand' order by fm.farm_id,fm.id
  loop
    v_result:=atlas.sync_worker_weekly_capacity_escalation_v2(r.farm_id,r.membership_id,(now() at time zone r.timezone)::date);
    v_results:=v_results||jsonb_build_array(v_result); v_count:=v_count+1;
  end loop;
  return jsonb_build_object('contractVersion','principal_farm_capacity_escalation_tick_v2','processedFarmHands',v_count,'results',v_results,'ranAt',now());
end;
$$;
