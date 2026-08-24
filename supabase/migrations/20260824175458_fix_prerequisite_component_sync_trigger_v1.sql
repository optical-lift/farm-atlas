create or replace function atlas.sync_task_execution_components_from_prerequisite_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_new_downstream uuid;
  v_old_downstream uuid;
begin
  if tg_op <> 'DELETE' then
    v_new_downstream := new.downstream_task_id;
    perform atlas.sync_task_execution_components_from_canonical_v1(v_new_downstream);
  end if;

  if tg_op <> 'INSERT' then
    v_old_downstream := old.downstream_task_id;
    if tg_op = 'DELETE' or v_old_downstream is distinct from v_new_downstream then
      perform atlas.sync_task_execution_components_from_canonical_v1(v_old_downstream);
    end if;
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$function$;

revoke all on function atlas.sync_task_execution_components_from_prerequisite_trigger_v1() from public, anon, authenticated;
grant execute on function atlas.sync_task_execution_components_from_prerequisite_trigger_v1() to service_role;

drop trigger if exists trg_sync_task_components_from_prerequisites_v1 on atlas.task_prerequisites;
create trigger trg_sync_task_components_from_prerequisites_v1
after insert or update or delete on atlas.task_prerequisites
for each row execute function atlas.sync_task_execution_components_from_prerequisite_trigger_v1();
