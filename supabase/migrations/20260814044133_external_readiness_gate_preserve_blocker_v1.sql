do $block$
declare
  v_def text;
  v_patched text;
begin
  select pg_get_functiondef('atlas.sync_task_external_readiness_gate_v1()'::regprocedure) into v_def;
  v_patched:=replace(
    v_def,
    'blocker_text=excluded.blocker_text,',
    'blocker_text=coalesce(nullif(atlas.task_external_readiness_gates.blocker_text, ''''),excluded.blocker_text),'
  );
  if v_patched=v_def then
    raise exception 'sync_task_external_readiness_gate_v1 blocker preservation insertion point was not found';
  end if;
  execute v_patched;
end;
$block$;
