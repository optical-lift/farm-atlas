do $patch$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='real_operation_explanation_v1'
    and pg_get_function_identity_arguments(p.oid)='p_transition_id uuid';

  if v_def is null then
    raise exception 'atlas.real_operation_explanation_v1(uuid) was not found';
  end if;

  if position('go.object_key' in v_def)=0 then
    raise exception 'Expected growing_objects object_key reference was not found in real_operation_explanation_v1';
  end if;

  v_def := replace(v_def,'go.object_key,go.label as object_label','go.stable_key as object_key,go.label as object_label');
  execute v_def;
end;
$patch$;