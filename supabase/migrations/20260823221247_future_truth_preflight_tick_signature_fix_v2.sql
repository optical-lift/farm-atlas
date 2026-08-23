drop function atlas.future_truth_preflight_tick_v1();
drop function atlas.future_truth_preflight_tick_v1(date);

create function atlas.future_truth_preflight_tick_v1(p_as_of_date date)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_day date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_cycle record;
  v_snapshot jsonb;
  v_result jsonb;
  v_results jsonb:='[]'::jsonb;
  v_evaluated integer:=0;
  v_opened_or_refreshed integer:=0;
  v_failed integer:=0;
begin
  for v_cycle in
    select cc.id
    from atlas.crop_cycles cc
    where coalesce(cc.lifecycle_status,'active')='active'
      and (
        coalesce((atlas.crop_cycle_future_transplant_preflight_v1(cc.id,v_day,42,14)->>'futureOperationPlanned')::boolean,false)
        or exists (
          select 1 from atlas.state_consequence_instances i
          join atlas.state_consequence_policies p on p.id=i.policy_id
          where i.subject_kind='crop_cycle' and i.subject_id=cc.id and i.status='open'
            and p.stable_key='crop-future-transplant-destination-truth-preflight-v1'
        )
      )
    order by cc.id
  loop
    begin
      v_snapshot:=atlas.state_consequence_snapshot_v1('crop_cycle',v_cycle.id);
      v_result:=atlas.reconcile_state_consequences_v1('crop_cycle',v_cycle.id);
      v_evaluated:=v_evaluated+1;
      if coalesce((v_snapshot->'futureTruthPreflight'->>'transplantDestinationPreflightDue')::boolean,false) then
        v_opened_or_refreshed:=v_opened_or_refreshed+1;
      end if;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('cropCycleId',v_cycle.id,'state','reconciled','futureTruthPreflight',v_snapshot->'futureTruthPreflight'));
    exception when others then
      v_failed:=v_failed+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('cropCycleId',v_cycle.id,'state','failed','sqlstate',sqlstate,'message',sqlerrm));
    end;
  end loop;
  return jsonb_build_object('contractVersion','future_truth_preflight_tick_v1','asOfDate',v_day,'evaluatedCropCycleCount',v_evaluated,
    'preflightDueCount',v_opened_or_refreshed,'failedCount',v_failed,'results',v_results,
    'truthBoundary',jsonb_build_object('futurePlanningEvidenceDoesNotCreateCurrentRequirement',true,'canonicalConsequenceReconcilerOwnsOpenAndClose',true,'oneFutureOccurrenceCreatesOneOwnerDecision',true));
end;$function$;

create function atlas.future_truth_preflight_tick_v1()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
  select atlas.future_truth_preflight_tick_v1((now() at time zone 'America/Chicago')::date);
$function$;

revoke all on function atlas.future_truth_preflight_tick_v1() from public,anon,authenticated;
revoke all on function atlas.future_truth_preflight_tick_v1(date) from public,anon,authenticated;
grant execute on function atlas.future_truth_preflight_tick_v1() to service_role;
grant execute on function atlas.future_truth_preflight_tick_v1(date) to service_role;

comment on function atlas.future_truth_preflight_tick_v1() is
'Tranche 1F service clock wrapper. Delegates to the explicit-date future truth preflight engine so scheduled and testable lifecycle paths share one implementation.';
comment on function atlas.future_truth_preflight_tick_v1(date) is
'Tranche 1F canonical lifecycle engine. Reconciles future truth acquisition for an explicit farm date without creating current operational requirements.';