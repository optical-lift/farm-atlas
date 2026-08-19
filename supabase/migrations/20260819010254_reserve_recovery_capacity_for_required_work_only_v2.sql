do $migration$
declare
  v_def text;
  v_old text := $$if v_is_placed then
      v_item_state:='presented'; v_item_reason:='committed_placement';
    elsif v_used_minutes+v_item.expected_active_minutes<=v_paid_target$$;
  v_new text := $$if v_is_placed then
      v_item_state:='presented'; v_item_reason:='committed_placement';
    elsif v_capacity_class='recovery' then
      v_item_state:='held'; v_item_reason:='recovery_reserved_for_required';
    elsif v_used_minutes+v_item.expected_active_minutes<=v_paid_target$$;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='presented_work_selection_rows_v2'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_work_date date';

  if v_def is null then raise exception 'presented_work_selection_rows_v2 definition not found'; end if;
  if position(v_old in v_def)=0 then raise exception 'Expected flexible-lane selector fragment not found; migration aborted'; end if;

  v_def:=replace(v_def,v_old,v_new);
  execute v_def;
end;
$migration$;