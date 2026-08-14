create or replace function atlas.guard_blocked_task_completion_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $$
begin
  if old.status = 'blocked' and new.status = 'done' then
    raise exception 'Blocked work must be unblocked before it can be completed.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_blocked_task_completion_v1 on atlas.tasks;
create trigger guard_blocked_task_completion_v1
before update of status on atlas.tasks
for each row
when (old.status is distinct from new.status)
execute function atlas.guard_blocked_task_completion_v1();

do $$
declare
  v_def text;
  v_patched text;
begin
  select pg_get_functiondef('atlas.owner_worker_day_plan_v1(uuid,uuid,date)'::regprocedure) into v_def;
  v_patched := replace(v_def, 'and t.status in (''open'',''blocked'')', 'and t.status = ''open''');
  if v_patched = v_def then
    raise exception 'owner_worker_day_plan_v1 status predicate was not found';
  end if;
  v_def := v_patched;
  v_patched := replace(
    v_def,
    E'      cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity\n    )',
    E'      cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity\n      where t.status = ''open''\n    )'
  );
  if v_patched = v_def then
    raise exception 'owner_worker_day_plan_v1 rows filter insertion point was not found';
  end if;
  execute v_patched;
end;
$$;
