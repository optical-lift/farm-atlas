do $migration$
declare
  v_oid oid;
  v_def text;
  v_old text := E'from atlas.presented_work_selection_rows_v3(p_farm_id, p_membership_id, v_work_date)\n    where presentation_state = ''presented'';';
  v_new text := E'from atlas.presented_work_selection_rows_v3(p_farm_id, p_membership_id, v_work_date) delegated\n    where delegated.presentation_state = ''presented'';';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='presented_work_selection_rows_live_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_work_date date';

  if v_oid is null then
    raise exception 'Canonical live Worker Day selector not found.';
  end if;

  v_def := pg_get_functiondef(v_oid);
  if position(v_old in v_def)=0 then
    raise exception 'Expected unqualified presentation_state delegation seam not found.';
  end if;

  v_def := replace(v_def,v_old,v_new);
  execute v_def;

  if position('delegated.presentation_state' in pg_get_functiondef(v_oid))=0 then
    raise exception 'Worker Day selector qualification did not persist.';
  end if;
end;
$migration$;
