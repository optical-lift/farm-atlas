create or replace function atlas.guard_daily_recurring_future_completion_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_is_daily boolean := false;
begin
  if new.status is not distinct from old.status
     or new.status <> 'done'
     or old.status = 'done'
     or new.due_date is null
     or new.due_date <= v_today then
    return new;
  end if;

  v_is_daily :=
    coalesce(new.metadata->>'repeat_rule','') in ('daily','daily_except_sunday')
    or coalesce((new.metadata->>'farm_round_parent')::boolean,false);

  if v_is_daily then
    raise exception 'Future daily recurring work cannot be completed before its service day (%).', new.due_date
      using errcode='P0001';
  end if;

  return new;
end;
$function$;

revoke all on function atlas.guard_daily_recurring_future_completion_v1() from public, anon, authenticated;
grant execute on function atlas.guard_daily_recurring_future_completion_v1() to service_role;

drop trigger if exists guard_daily_recurring_future_completion_v1 on atlas.tasks;
create trigger guard_daily_recurring_future_completion_v1
before update of status on atlas.tasks
for each row
execute function atlas.guard_daily_recurring_future_completion_v1();