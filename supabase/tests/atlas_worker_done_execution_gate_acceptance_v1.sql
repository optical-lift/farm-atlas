begin;

do $proof$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'atlas.worker_record_task_transition_v1(uuid,text,text,text,text,jsonb,date,text,text,uuid)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'Worker task transition function is missing.';
  end if;

  if position('if p_transition = ''done'' then' in v_definition)=0
     or position('task_execution_readiness_v1' in v_definition)=0
     or position('worker_state_transition_card_v2' in v_definition)=0
     or position('authorized_for_routed_day' in v_definition)=0 then
    raise exception 'Worker Done is missing its canonical execution authorization gate.';
  end if;

  if position('23514' in v_definition)=0
     or position('This work is not executable in current farm reality.' in v_definition)=0 then
    raise exception 'Worker Done no longer fails inward with the execution-boundary contract.';
  end if;
end;
$proof$;

rollback;
