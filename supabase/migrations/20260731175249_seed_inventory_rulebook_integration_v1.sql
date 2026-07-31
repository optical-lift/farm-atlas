-- Surface seed inventory freshness in the shared Owner Rulebook and cadence controls.

do $$
declare v_definition text;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='biological_rhythm_dashboard_v1';

  if v_definition not like '%seed_inventory_freshness%' then
    v_definition:=replace(
      v_definition,
      $old$      when rs.subject_kind='project' then (select title from atlas.projects where id=rs.subject_id)
      else rs.subject_id::text end,$old$,
      $new$      when rs.subject_kind='project' then (select title from atlas.projects where id=rs.subject_id)
      when rs.subject_kind='seed_lot' then (select lot_label from atlas.seed_lots where id=rs.subject_id)
      else rs.subject_id::text end,$new$
    );
    v_definition:=replace(
      v_definition,
      $old$      when rs.rhythm_key='project_review' then 'The Owner chose this project review cadence. Time can require a decision, but only a recorded review may change project health, milestone, waiting state, blockage, or completion.'
      else$old$,
      $new$      when rs.rhythm_key='project_review' then 'The Owner chose this project review cadence. Time can require a decision, but only a recorded review may change project health, milestone, waiting state, blockage, or completion.'
      when rs.rhythm_key='seed_inventory_freshness' then 'The Owner chose how long a physical seed count remains trustworthy. Time may require another count, but it never changes quantity or claims seed was received, consumed, lost, or damaged.'
      else$new$
    );
    v_definition:=replace(
      v_definition,
      $old$('grow_room_care','germination_watch','harvest_watch','guest_readiness','mowing','project_review')$old$,
      $new$('grow_room_care','germination_watch','harvest_watch','guest_readiness','mowing','project_review','seed_inventory_freshness')$new$
    );
    execute v_definition;
  end if;
end;
$$;

do $$
declare v_definition text;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='owner_revise_biological_rhythm_rule_v1';
  v_definition:=replace(
    v_definition,
    $old$v_rule.rhythm_key not in ('grow_room_care','germination_watch')$old$,
    $new$v_rule.rhythm_key not in ('grow_room_care','germination_watch','harvest_watch','guest_readiness','mowing','project_review','seed_inventory_freshness')$new$
  );
  execute v_definition;
end;
$$;