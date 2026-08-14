begin;

do $migration$
declare
  v_definition text;
  v_updated text;
  v_declaration_old text := $old$  v_real_has_active_weed boolean:=false;
begin$old$;
  v_declaration_new text := $new$  v_real_has_active_weed boolean:=false;
  v_carry_task_ids uuid[]:=array[]::uuid[];
  v_carry_snapshot_day date;
  v_carry_snapshot_ready boolean:=false;
begin$new$;
  v_real_start_old text := $old$  begin
    with ids as ($old$;
  v_real_start_new text := $new$  begin
    select coalesce(array_agg(carry.task_id order by carry.task_id),array[]::uuid[])
    into v_carry_task_ids
    from atlas.member_day_carryover_v1(p_farm_id,p_membership_id,p_day) carry;
    v_carry_snapshot_day:=p_day;
    v_carry_snapshot_ready:=true;

    with ids as ($new$;
  v_real_carry_old text := $old$      select carry.task_id
      from atlas.member_day_carryover_v1(p_farm_id,p_membership_id,p_day) carry$old$;
  v_real_carry_new text := $new$      select snapshot.task_id
      from unnest(v_carry_task_ids) as snapshot(task_id)$new$;
  v_mow_start_old text := $old$      if v_day=v_first_workday then
        select q.* into v_explicit_mow$old$;
  v_mow_start_new text := $new$      if v_day=v_first_workday then
        if not v_carry_snapshot_ready or v_carry_snapshot_day is distinct from v_day then
          select coalesce(array_agg(carry.task_id order by carry.task_id),array[]::uuid[])
          into v_carry_task_ids
          from atlas.member_day_carryover_v1(p_farm_id,p_membership_id,v_day) carry;
          v_carry_snapshot_day:=v_day;
          v_carry_snapshot_ready:=true;
        end if;

        select q.* into v_explicit_mow$new$;
  v_mow_carry_old text := $old$          from atlas.member_day_carryover_v1(p_farm_id,p_membership_id,v_day) carry
          join atlas.tasks t on t.id=carry.task_id$old$;
  v_mow_carry_new text := $new$          from unnest(v_carry_task_ids) as snapshot(task_id)
          join atlas.tasks t on t.id=snapshot.task_id$new$;
begin
  select pg_get_functiondef('atlas.owner_worker_day_plan_v1(uuid,uuid,date)'::regprocedure)
  into v_definition;

  if v_definition is null then
    raise exception 'owner_worker_day_plan_v1 must exist before the carry snapshot migration.';
  end if;

  if position('v_carry_snapshot_ready boolean:=false' in v_definition)>0 then
    return;
  end if;

  if position(v_declaration_old in v_definition)=0
     or position(v_real_start_old in v_definition)=0
     or position(v_real_carry_old in v_definition)=0
     or position(v_mow_start_old in v_definition)=0
     or position(v_mow_carry_old in v_definition)=0 then
    raise exception 'owner_worker_day_plan_v1 no longer matches the expected pre-snapshot contract.';
  end if;

  v_updated:=replace(v_definition,v_declaration_old,v_declaration_new);
  v_updated:=replace(v_updated,v_real_start_old,v_real_start_new);
  v_updated:=replace(v_updated,v_real_carry_old,v_real_carry_new);
  v_updated:=replace(v_updated,v_mow_start_old,v_mow_start_new);
  v_updated:=replace(v_updated,v_mow_carry_old,v_mow_carry_new);

  if v_updated=v_definition
     or position('from unnest(v_carry_task_ids) as snapshot(task_id)' in v_updated)=0
     or position('v_carry_snapshot_day:=p_day' in v_updated)=0
     or position('v_carry_snapshot_day is distinct from v_day' in v_updated)=0 then
    raise exception 'Carry snapshot rewrite did not produce the required planner contract.';
  end if;

  execute v_updated;
end;
$migration$;

commit;
