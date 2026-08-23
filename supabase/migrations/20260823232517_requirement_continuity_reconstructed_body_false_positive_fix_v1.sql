do $migration$
declare
  v_def text;
  v_old text := E'where ce.response_required\n      and not coalesce((ce.snapshot->>''profilePresent'')::boolean,false)\n      and not coalesce((ce.biological->>''applicable'')::boolean,false)';
  v_new text := E'where ce.response_required\n      and not ce.requirement_expressed\n      and not coalesce((ce.snapshot->>''profilePresent'')::boolean,false)\n      and not coalesce((ce.biological->>''applicable'')::boolean,false)';
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='requirement_continuity_audit_v1'
  limit 1;

  if v_def is null then
    raise exception 'atlas.requirement_continuity_audit_v1 not found';
  end if;
  if position(v_old in v_def)=0 then
    raise exception 'Expected reconstructed-body audit predicate not found';
  end if;

  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end
$migration$;