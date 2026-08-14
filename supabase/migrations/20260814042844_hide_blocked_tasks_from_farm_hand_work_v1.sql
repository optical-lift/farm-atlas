do $$
declare
  v_def text;
  v_patched text;
begin
  select pg_get_functiondef('atlas.home_task_cards_for_membership_v2(uuid,uuid,date,date)'::regprocedure) into v_def;
  v_patched := replace(
    v_def,
    E'  where card.status in (''open'', ''blocked'', ''done'')\n  order by selected.surface_group, selected.lane_order, selected.selection_rank;',
    E'  where card.status in (''open'', ''blocked'', ''done'')\n    and not (v_role = ''farm_hand'' and card.status = ''blocked'')\n  order by selected.surface_group, selected.lane_order, selected.selection_rank;'
  );
  if v_patched = v_def then
    raise exception 'home_task_cards_for_membership_v2 final card filter was not found';
  end if;
  execute v_patched;
end;
$$;
