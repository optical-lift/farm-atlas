do $migration$
declare
  v_def text;
  v_old text := $old$and (
        value->>'legacyPresentationReason' in ('protected_minimum_selected','consequence_required_selected','hard_date_selected','required_over_capacity','required_selected')
        or (
          coalesce((value->>'recoveryRequired')::boolean,false)
          and value->>'legacyPresentationReason' in ('within_day_capacity','next_up_capacity','next_up_heavy_capacity')
        )
      )$old$;
  v_new text := $new$and coalesce((value->>'recoveryRequired')::boolean,false)
      and value->>'legacyPresentationReason' in (
        'protected_minimum_selected','consequence_required_selected','hard_date_selected','required_over_capacity','required_selected',
        'within_day_capacity','next_up_capacity','next_up_heavy_capacity'
      )$new$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='presented_work_selection_rows_v3';
  if v_def is null or position(v_old in v_def)=0 then
    raise exception 'presented_work_selection_rows_v3 recovery gate patch target not found';
  end if;
  execute replace(v_def,v_old,v_new);
end;
$migration$;
