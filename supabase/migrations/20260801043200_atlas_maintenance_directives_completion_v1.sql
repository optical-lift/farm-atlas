begin;

create or replace function atlas.complete_matching_maintenance_directives_v1(
  p_task_id uuid,
  p_result_kind text,
  p_result_value text,
  p_result_payload jsonb,
  p_actor_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_count integer;
begin
  update atlas.maintenance_directives directive
  set status='completed',
      completed_at=now(),
      completed_by_user_id=p_actor_user_id,
      completion_payload=coalesce(p_result_payload,'{}'::jsonb)||jsonb_build_object('resultKind',p_result_kind,'resultValue',p_result_value),
      updated_at=now()
  where directive.serving_task_id=p_task_id
    and directive.status='active'
    and directive.directive_kind='instruction'
    and (
      directive.effect_policy in ('bring_forward_only','inspection_only')
      or (
        directive.effect_policy='full_maintenance'
        and (
          (directive.maintenance_kind='weed' and p_result_value='clear')
          or (directive.maintenance_kind='mow' and p_result_value='mowed_full')
        )
      )
      or (
        directive.effect_policy='target_condition'
        and directive.maintenance_kind='weed'
        and atlas.weed_condition_rank_v1(p_result_value) >= atlas.weed_condition_rank_v1(directive.target_condition)
      )
    );
  get diagnostics v_count = row_count;

  update atlas.tasks task
  set metadata = task.metadata
        - 'active_maintenance_directive_id'
        - 'active_maintenance_directive_title'
        - 'maintenance_effect_policy'
        - 'maintenance_target_condition',
      updated_at = now()
  where task.id = p_task_id
    and not exists (
      select 1 from atlas.maintenance_directives directive
      where directive.serving_task_id = p_task_id and directive.status = 'active'
    );

  return v_count;
end;
$function$;

create or replace function atlas.complete_directives_from_weed_session_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
begin
  perform atlas.complete_matching_maintenance_directives_v1(
    new.task_id,
    'weed_session',
    new.condition_after,
    jsonb_build_object('weedSessionId',new.id,'weedPassId',new.weed_pass_id,'minutes',new.minutes,'conditionAfter',new.condition_after),
    new.actor_user_id
  );
  return new;
end;
$function$;

drop trigger if exists complete_directives_from_weed_session_v1 on atlas.weed_sessions;
create trigger complete_directives_from_weed_session_v1
after insert on atlas.weed_sessions
for each row execute function atlas.complete_directives_from_weed_session_v1();

create or replace function atlas.complete_directives_from_mowing_event_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
begin
  perform atlas.complete_matching_maintenance_directives_v1(
    new.task_id,
    'mowing_event',
    new.outcome,
    jsonb_build_object('mowingEventId',new.id,'outcome',new.outcome,'completionPercent',new.completion_percent,'recheckDate',new.recheck_date),
    new.created_by_user_id
  );
  return new;
end;
$function$;

drop trigger if exists complete_directives_from_mowing_event_v1 on atlas.mowing_events;
create trigger complete_directives_from_mowing_event_v1
after insert on atlas.mowing_events
for each row execute function atlas.complete_directives_from_mowing_event_v1();

create or replace function atlas.release_maintenance_prerequisite_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_directive atlas.maintenance_directives%rowtype;
begin
  if new.status <> 'done' or old.status = 'done' then return new; end if;

  for v_directive in
    select * from atlas.maintenance_directives
    where prerequisite_task_id=new.id and status='active'
    for update
  loop
    update atlas.maintenance_directives
    set status='completed', completed_at=coalesce(new.completed_at,now()),
        completed_by_user_id=coalesce((select transition.actor_user_id from atlas.task_transitions transition where transition.task_id=new.id and transition.next_status='done' order by transition.created_at desc limit 1),new.assigned_user_id,new.created_by_user_id),
        completion_payload=jsonb_build_object('kind','prerequisite_completed','taskId',new.id),
        updated_at=now()
    where id=v_directive.id;

    update atlas.tasks
    set status='open', blocker_text=null,
        metadata=(metadata - 'maintenance_prerequisite_task_id' - 'maintenance_prerequisite_title')
          - 'active_maintenance_directive_id' - 'active_maintenance_directive_title' - 'maintenance_effect_policy' - 'maintenance_target_condition'
          || jsonb_build_object('maintenance_prerequisite_completed_at',coalesce(new.completed_at,now()),'maintenance_directive_id',v_directive.id),
        updated_at=now()
    where id=v_directive.serving_task_id
      and status='blocked'
      and metadata->>'maintenance_prerequisite_task_id'=new.id::text;
  end loop;

  return new;
end;
$function$;

drop trigger if exists release_maintenance_prerequisite_v1 on atlas.tasks;
create trigger release_maintenance_prerequisite_v1
after update of status on atlas.tasks
for each row execute function atlas.release_maintenance_prerequisite_v1();

revoke all on function atlas.maintenance_directive_window_v1(text) from public, anon, authenticated;
revoke all on function atlas.maintenance_directive_json_v1(uuid) from public, anon, authenticated;
revoke all on function atlas.complete_matching_maintenance_directives_v1(uuid,text,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function atlas.complete_directives_from_weed_session_v1() from public, anon, authenticated;
revoke all on function atlas.complete_directives_from_mowing_event_v1() from public, anon, authenticated;
revoke all on function atlas.release_maintenance_prerequisite_v1() from public, anon, authenticated;
grant execute on function atlas.maintenance_directive_window_v1(text) to service_role;
grant execute on function atlas.maintenance_directive_json_v1(uuid) to service_role;
grant execute on function atlas.complete_matching_maintenance_directives_v1(uuid,text,text,jsonb,uuid) to service_role;
grant execute on function atlas.complete_directives_from_weed_session_v1() to service_role;
grant execute on function atlas.complete_directives_from_mowing_event_v1() to service_role;
grant execute on function atlas.release_maintenance_prerequisite_v1() to service_role;

revoke all on function atlas.maintenance_directive_context_v1(uuid,text) from public, anon;
revoke all on function atlas.maintenance_directives_for_task_v1(uuid) from public, anon;
revoke all on function atlas.create_object_maintenance_directive_v1(uuid,text,text,text,text,text,uuid,date,text,text,text,uuid[],text[],text) from public, anon;
revoke all on function atlas.cancel_maintenance_directive_v1(uuid,text) from public, anon;
revoke all on function atlas.set_maintenance_directive_step_v1(uuid,boolean) from public, anon;
grant execute on function atlas.maintenance_directive_context_v1(uuid,text) to authenticated, service_role;
grant execute on function atlas.maintenance_directives_for_task_v1(uuid) to authenticated, service_role;
grant execute on function atlas.create_object_maintenance_directive_v1(uuid,text,text,text,text,text,uuid,date,text,text,text,uuid[],text[],text) to authenticated, service_role;
grant execute on function atlas.cancel_maintenance_directive_v1(uuid,text) to authenticated, service_role;
grant execute on function atlas.set_maintenance_directive_step_v1(uuid,boolean) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, registered_at, reviewed_at
) values
(
  'atlas.maintenance_directive_context_v1(uuid, text)', 'app_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','object_maintenance_directives_v1','call_site','object maintenance composer','authorization','active same-farm membership','reviewed_date','2026-08-01'),
  now(), now()
),
(
  'atlas.maintenance_directives_for_task_v1(uuid)', 'app_endpoint', 'verified', 'active',
  true, true, true, 2, 0,
  jsonb_build_object('source','object_maintenance_directives_v1','call_site','Weed and Mowing task focus','authorization','can_read_task_in_journal_v1','reviewed_date','2026-08-01'),
  now(), now()
),
(
  'atlas.create_object_maintenance_directive_v1(uuid, text, text, text, text, text, uuid, date, text, text, text, uuid[], text[], text)', 'owner_admin_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','object_maintenance_directives_v1','call_site','object maintenance composer','authorization','owner or manager','reviewed_date','2026-08-01'),
  now(), now()
),
(
  'atlas.set_maintenance_directive_step_v1(uuid, boolean)', 'app_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','object_maintenance_directives_v1','call_site','maintenance directive checklist','authorization','assigned player, manager, or owner','reviewed_date','2026-08-01'),
  now(), now()
),
(
  'atlas.cancel_maintenance_directive_v1(uuid, text)', 'owner_admin_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','object_maintenance_directives_v1','call_site','object maintenance composer','authorization','owner or manager','reviewed_date','2026-08-01'),
  now(), now()
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

comment on table atlas.maintenance_directives is
  'Temporary Owner/manager instructions and prerequisites attached to a persistent Weed Card or governed Mowing Card. The directive never becomes a rival maintenance identity.';
comment on function atlas.create_object_maintenance_directive_v1(uuid,text,text,text,text,text,uuid,date,text,text,text,uuid[],text[],text) is
  'Object-first authoring endpoint. Reuses or releases the persistent maintenance card serving, links real crops, stages notifications, and optionally creates one prerequisite task.';

commit;
