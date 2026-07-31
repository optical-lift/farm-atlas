-- Preserve the specialized Guest Readiness recovery state after canonical task transitions run.

do $$
declare
  v_definition text;
  v_marker text := E'    update atlas.rhythm_state set state=''recovering'',recovery_started_at=coalesce(recovery_started_at,v_now),current_task_id=v_task.id,current_occurrence_id=v_task.planned_occurrence_id,\n      state_reason=jsonb_build_object(''source'',''guest_readiness_round'',''roundId'',v_round_id,''aggregateOutcome'',v_aggregate),updated_at=v_now where id=v_state.id;\n  end if;\n\n  return jsonb_build_object(';
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='record_guest_readiness_round_core_v1';

  if v_definition is null then
    raise exception 'Guest Readiness core function was not found.';
  end if;

  if position(v_marker in v_definition)=0 then
    raise exception 'Guest Readiness must restore recovering state after the canonical task transition.';
  end if;
end;
$$;
