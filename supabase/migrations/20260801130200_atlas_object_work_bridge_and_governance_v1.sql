begin;

create or replace function atlas.sync_object_work_release_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare v_item atlas.object_work_items%rowtype; v_task atlas.tasks%rowtype; v_action jsonb;
begin
  if new.source_kind <> 'object_work_item' or new.released_task_id is null or new.released_task_id is not distinct from old.released_task_id then
    return new;
  end if;
  select * into v_item from atlas.object_work_items where id=new.source_id for update;
  if v_item.id is null then return new; end if;
  select * into v_task from atlas.tasks where id=new.released_task_id;
  v_action := atlas.object_work_action_contract_v1(v_item.action_kind);

  update atlas.tasks
  set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'object_work_item_id',v_item.id,
        'manual_object_work',true,
        'done_definition',v_item.done_definition,
        'release_mode',v_item.release_mode
      ),
      updated_at=now()
  where id=v_task.id;

  update atlas.object_work_items
  set status='released', task_id=v_task.id, due_date=v_task.due_date, updated_at=now()
  where id=v_item.id;

  insert into atlas.task_notification_plans(
    farm_id, task_id, release_local_time, close_local_time, nudge_after_minutes,
    group_key, group_label, source, active, metadata
  ) values (
    v_item.farm_id, v_task.id, v_item.release_local_time, v_item.close_local_time, 60,
    'object-work:' || (v_item.metadata ->> 'objectKey') || ':' || v_item.action_kind,
    v_action ->> 'label', 'object_work_authoring', true,
    jsonb_build_object('object_work_item_id',v_item.id,'object_id',v_item.object_id,'work_window_key',v_item.work_window_key)
  )
  on conflict (task_id) do update
  set release_local_time=excluded.release_local_time,
      close_local_time=excluded.close_local_time,
      nudge_after_minutes=excluded.nudge_after_minutes,
      group_key=excluded.group_key,
      group_label=excluded.group_label,
      source=excluded.source,
      active=true,
      metadata=atlas.task_notification_plans.metadata || excluded.metadata,
      updated_at=now();
  return new;
end;
$function$;

drop trigger if exists trg_sync_object_work_release_v1 on atlas.planned_work_occurrences;
create trigger trg_sync_object_work_release_v1
after update of released_task_id on atlas.planned_work_occurrences
for each row execute function atlas.sync_object_work_release_v1();

create or replace function atlas.sync_object_work_from_task_status_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status='done' then
    update atlas.object_work_items
    set status='completed', completed_at=coalesce(new.completed_at,now()),
        completion_payload=jsonb_build_object('taskStatus',new.status,'taskId',new.id), updated_at=now()
    where task_id=new.id and status='released';
    update atlas.planned_work_occurrences
    set state='completed', updated_at=now()
    where released_task_id=new.id and source_kind='object_work_item';
  elsif new.status in ('skipped','archived') then
    update atlas.object_work_items
    set status='cancelled', completion_payload=jsonb_build_object('taskStatus',new.status,'taskId',new.id), updated_at=now()
    where task_id=new.id and status in ('released','completed');
    update atlas.planned_work_occurrences
    set state='cancelled', updated_at=now()
    where released_task_id=new.id and source_kind='object_work_item';
  elsif new.status in ('open','blocked') and old.status in ('done','skipped','archived') then
    update atlas.object_work_items
    set status='released', completed_at=null, completion_payload='{}'::jsonb, updated_at=now()
    where task_id=new.id;
    update atlas.planned_work_occurrences
    set state='released', updated_at=now()
    where released_task_id=new.id and source_kind='object_work_item';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_sync_object_work_from_task_status_v1 on atlas.tasks;
create trigger trg_sync_object_work_from_task_status_v1
after update of status on atlas.tasks
for each row execute function atlas.sync_object_work_from_task_status_v1();

revoke all on function atlas.object_work_action_contract_v1(text) from public, anon, authenticated;
revoke all on function atlas.object_work_item_json_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.sync_object_work_release_v1() from public, anon, authenticated;
revoke all on function atlas.sync_object_work_from_task_status_v1() from public, anon, authenticated;
grant execute on function atlas.object_work_action_contract_v1(text) to service_role;
grant execute on function atlas.object_work_item_json_v1(uuid) to service_role;
grant execute on function atlas.sync_object_work_release_v1() to service_role;
grant execute on function atlas.sync_object_work_from_task_status_v1() to service_role;

revoke all on function atlas.object_work_context_v1(uuid,text) from public, anon;
revoke all on function atlas.create_object_work_v1(uuid,text,text,text,text,text,text,text,uuid,date,text,text,uuid[],text[],text) from public, anon;
revoke all on function atlas.object_work_for_task_v1(uuid) from public, anon;
revoke all on function atlas.set_object_work_step_v1(uuid,boolean) from public, anon;
revoke all on function atlas.cancel_object_work_plan_v1(uuid,text) from public, anon;
grant execute on function atlas.object_work_context_v1(uuid,text) to authenticated, service_role;
grant execute on function atlas.create_object_work_v1(uuid,text,text,text,text,text,text,text,uuid,date,text,text,uuid[],text[],text) to authenticated, service_role;
grant execute on function atlas.object_work_for_task_v1(uuid) to authenticated, service_role;
grant execute on function atlas.set_object_work_step_v1(uuid,boolean) to authenticated, service_role;
grant execute on function atlas.cancel_object_work_plan_v1(uuid,text) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, registered_at, reviewed_at
) values
(
  'atlas.object_work_context_v1(uuid, text)', 'app_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','object_work_authoring_v1','call_site','object work composer','authorization','active same-farm membership','reviewed_date','2026-08-01'), now(), now()
),
(
  'atlas.create_object_work_v1(uuid, text, text, text, text, text, text, text, uuid, date, text, text, uuid[], text[], text)', 'owner_admin_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','object_work_authoring_v1','call_site','object work composer','authorization','owner or manager','reviewed_date','2026-08-01'), now(), now()
),
(
  'atlas.object_work_for_task_v1(uuid)', 'app_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','object_work_authoring_v1','call_site','generic task focus','authorization','canonical task visibility','reviewed_date','2026-08-01'), now(), now()
),
(
  'atlas.set_object_work_step_v1(uuid, boolean)', 'app_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','object_work_authoring_v1','call_site','object work checklist','authorization','assigned player, manager, or owner','reviewed_date','2026-08-01'), now(), now()
),
(
  'atlas.cancel_object_work_plan_v1(uuid, text)', 'owner_admin_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','object_work_authoring_v1','call_site','object work composer','authorization','owner or manager, planned work only','reviewed_date','2026-08-01'), now(), now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;

commit;
