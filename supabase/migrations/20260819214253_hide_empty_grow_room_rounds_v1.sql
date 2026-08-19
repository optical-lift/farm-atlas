create or replace function atlas.grow_room_round_has_actionable_work_v1(
  p_farm_id uuid,
  p_visit_due_date date,
  p_assigned_membership_id uuid default null,
  p_visit_task_id uuid default null
) returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $fn$
  select exists (
    select 1
    from atlas.tasks t
    left join atlas.zones z on z.id=t.zone_id
    where t.farm_id=p_farm_id
      and (p_visit_task_id is null or t.id<>p_visit_task_id)
      and t.status in ('open','blocked')
      and t.visibility_scope<>'system_internal'
      and coalesce(t.due_date,p_visit_due_date)<=p_visit_due_date
      and t.parent_task_id is null
      and (
        p_assigned_membership_id is null
        or t.assigned_membership_id is null
        or t.assigned_membership_id=p_assigned_membership_id
      )
      and (
        t.task_type in ('germination_check','grow_room_check')
        or (
          t.task_type='grow_room_care'
          and lower(coalesce(t.action_key,'')) not in ('water','watered','watering','moisture_check','grow_room_round')
        )
      )
      and (
        z.stable_key='grow_room'
        or coalesce(t.metadata->>'collection_zone','') ilike '%grow room%'
        or coalesce(t.metadata->>'location_label','') ilike '%grow room%'
        or coalesce(t.metadata->>'work_route','')='grow_room_check'
      )
  );
$fn$;

revoke all on function atlas.grow_room_round_has_actionable_work_v1(uuid,date,uuid,uuid) from public,anon,authenticated;
grant execute on function atlas.grow_room_round_has_actionable_work_v1(uuid,date,uuid,uuid) to service_role;

create or replace function atlas.suppress_empty_grow_room_round_task_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $fn$
begin
  if new.task_type='grow_room_care'
     and lower(coalesce(new.action_key,''))='grow_room_round'
     and new.status in ('open','blocked')
     and new.due_date is not null
     and not atlas.grow_room_round_has_actionable_work_v1(new.farm_id,new.due_date,new.assigned_membership_id,new.id)
  then
    new.status:='skipped';
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'empty_round_no_actionable_work',true,
      'empty_round_suppressed_at',now(),
      'empty_round_rule','Do not surface a Grow Room carrier when there is no actual Grow Room request to complete.'
    );
  end if;
  return new;
end;
$fn$;

drop trigger if exists suppress_empty_grow_room_round_task_v1 on atlas.tasks;
create trigger suppress_empty_grow_room_round_task_v1
before insert or update of status,due_date,assigned_membership_id,metadata,task_type,action_key on atlas.tasks
for each row execute function atlas.suppress_empty_grow_room_round_task_v1();

do $block$
declare
  v_sql text;
begin
  select pg_get_functiondef('atlas.grow_room_round_v1(uuid,uuid)'::regprocedure) into v_sql;
  v_sql:=replace(
    v_sql,
    $old$'canFinish', v_visit.status in ('open', 'blocked') and v_unresolved = 0$old$,
    $new$'canFinish', v_visit.status in ('open', 'blocked') and v_total > 0 and v_unresolved = 0$new$
  );
  execute v_sql;

  select pg_get_functiondef('atlas.grow_room_finish_round_v1(uuid,uuid,text)'::regprocedure) into v_sql;
  v_sql:=replace(
    v_sql,
    $old$  if v_unresolved > 0 then
    raise exception 'Resolve today''s Grow Room requests before finishing the round.' using errcode = '22023';
  end if;$old$,
    $new$  if v_total = 0 then
    raise exception 'There is no Grow Room work to finish.' using errcode = '22023';
  end if;

  if v_unresolved > 0 then
    raise exception 'Resolve today''s Grow Room requests before finishing the round.' using errcode = '22023';
  end if;$new$
  );
  execute v_sql;
end
$block$;

update atlas.tasks t
set status='skipped',
    metadata=coalesce(t.metadata,'{}'::jsonb)||jsonb_build_object(
      'empty_round_no_actionable_work',true,
      'empty_round_suppressed_at',now(),
      'empty_round_rule','Do not surface a Grow Room carrier when there is no actual Grow Room request to complete.'
    ),
    updated_at=now()
where t.task_type='grow_room_care'
  and lower(coalesce(t.action_key,''))='grow_room_round'
  and t.status in ('open','blocked')
  and t.due_date is not null
  and not atlas.grow_room_round_has_actionable_work_v1(t.farm_id,t.due_date,t.assigned_membership_id,t.id);