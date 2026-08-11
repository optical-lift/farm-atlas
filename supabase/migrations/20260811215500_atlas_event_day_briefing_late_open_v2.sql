-- Event Day first-open briefing v2
-- Dynamic event briefings are orientation, not work. They should describe the
-- event from the worker's present moment and stop appearing when the event is over.

create or replace function atlas.event_project_end_at_v1(
  p_project_id uuid
)
returns timestamptz
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_project atlas.projects%rowtype;
  v_end_text text;
  v_end_local timestamp;
begin
  select * into v_project
  from atlas.projects project
  where project.id=p_project_id;

  if v_project.id is null or v_project.target_date is null then
    return null;
  end if;

  v_end_text:=nullif(btrim(v_project.metadata->>'event_time_end'),'');
  if v_end_text is null or v_end_text !~ '^[0-2][0-9]:[0-5][0-9](:[0-5][0-9])?$' then
    v_end_text:='23:59:59';
  end if;

  v_end_local:=(v_project.target_date::text||' '||v_end_text)::timestamp;
  return v_end_local at time zone 'America/Chicago';
end;
$function$;

revoke all on function atlas.event_project_end_at_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.event_project_end_at_v1(uuid) to service_role;

create or replace function atlas.event_day_briefing_body_v1(
  p_project_id uuid,
  p_membership_id uuid,
  p_day date
)
returns text
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_project atlas.projects%rowtype;
  v_remaining integer:=0;
  v_lebanon_harvest boolean:=false;
  v_setup boolean:=false;
  v_now_local timestamp:=now() at time zone 'America/Chicago';
  v_start_text text;
  v_end_text text;
  v_start_local timestamp;
  v_end_local timestamp;
  v_minutes_to_start numeric;
begin
  select * into v_project
  from atlas.projects project
  where project.id=p_project_id;

  if v_project.id is null then
    return null;
  end if;

  select
    count(*)::integer,
    coalesce(bool_or(
      task.task_type='harvest'
      and (
        coalesce(task.metadata->>'departure_label','')='Lebanon'
        or coalesce(task.metadata->>'address','') ilike '%Lebanon%'
        or coalesce(task.metadata->>'location_name','') ilike '%Karianne%'
      )
    ),false),
    coalesce(bool_or(task.task_type='event_setup'),false)
  into v_remaining,v_lebanon_harvest,v_setup
  from atlas.project_task_links link
  join atlas.tasks task on task.id=link.task_id
  where link.project_id=p_project_id
    and task.assigned_membership_id=p_membership_id
    and task.status in ('open','blocked')
    and coalesce(task.due_date,p_day)<=p_day
    and task.visibility_scope='assigned_worker';

  v_start_text:=nullif(btrim(v_project.metadata->>'event_time_start'),'');
  if v_start_text is null or v_start_text !~ '^[0-2][0-9]:[0-5][0-9](:[0-5][0-9])?$' then
    v_start_text:='18:00:00';
  end if;
  v_end_text:=nullif(btrim(v_project.metadata->>'event_time_end'),'');
  if v_end_text is null or v_end_text !~ '^[0-2][0-9]:[0-5][0-9](:[0-5][0-9])?$' then
    v_end_text:='23:59:59';
  end if;

  v_start_local=(v_project.target_date::text||' '||v_start_text)::timestamp;
  v_end_local=(v_project.target_date::text||' '||v_end_text)::timestamp;
  v_minutes_to_start:=extract(epoch from (v_start_local-v_now_local))/60.0;

  if p_day=v_project.target_date and v_now_local>=v_end_local then
    return 'The event has ended.';
  end if;

  if p_day=v_project.target_date and v_now_local>=v_start_local then
    if v_remaining=0 then
      return 'The event is underway. Your assigned setup is finished.';
    end if;
    return 'The event is underway. '||v_remaining::text||' assigned moves are still open. Do only what still helps guests now.';
  end if;

  if p_day=v_project.target_date and v_minutes_to_start between 0 and 90 then
    if v_remaining=0 then
      return 'The event starts soon. Your assigned setup is already finished.';
    end if;
    return 'The event starts soon. '||v_remaining::text||' assigned moves remain. Do the moves that directly make guest arrival ready first.';
  end if;

  if v_remaining=0 then
    return 'Everything assigned to you for tonight is already finished.';
  end if;

  if p_day=v_project.target_date and v_now_local::time>=time '12:00' and v_lebanon_harvest then
    if v_setup then
      return 'Lebanon harvest is still open. Elm setup follows. '||v_remaining::text||' moves remain before tonight.';
    end if;
    return 'Lebanon harvest is still open. '||v_remaining::text||' moves remain before tonight.';
  end if;

  if v_lebanon_harvest and v_setup then
    return 'Lebanon harvest this morning. Elm setup afterward. '||v_remaining::text||' moves make tonight ready.';
  end if;
  if v_lebanon_harvest then
    return 'Lebanon harvest is the first move. '||v_remaining::text||' moves remain for tonight.';
  end if;
  if v_setup then
    return 'Elm setup is what remains. '||v_remaining::text||' moves remain for tonight.';
  end if;
  return v_remaining::text||' moves remain for tonight.';
end;
$function$;

revoke all on function atlas.event_day_briefing_body_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.event_day_briefing_body_v1(uuid,uuid,date) to service_role;

create or replace function atlas.prepare_dynamic_event_briefing_expiry_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_project_id uuid;
  v_event_end timestamptz;
begin
  if new.cue_kind<>'briefing' or nullif(new.payload->>'dynamicProjectId','') is null then
    return new;
  end if;

  begin
    v_project_id:=(new.payload->>'dynamicProjectId')::uuid;
  exception when invalid_text_representation then
    raise exception 'Dynamic event briefing project id is invalid.' using errcode='22023';
  end;

  v_event_end:=atlas.event_project_end_at_v1(v_project_id);
  if v_event_end is not null then
    new.expires_at:=v_event_end;
    new.recovery_policy:='expire';
  end if;
  return new;
end;
$function$;

revoke all on function atlas.prepare_dynamic_event_briefing_expiry_v1() from public,anon,authenticated;
grant execute on function atlas.prepare_dynamic_event_briefing_expiry_v1() to service_role;

drop trigger if exists zzzz_prepare_dynamic_event_briefing_expiry_v1 on atlas.worker_day_cues;
create trigger zzzz_prepare_dynamic_event_briefing_expiry_v1
before insert or update of cue_kind,payload,expires_at,recovery_policy
on atlas.worker_day_cues
for each row execute function atlas.prepare_dynamic_event_briefing_expiry_v1();

-- Reconcile already-created dynamic event briefings to the event's actual end
-- time rather than midnight after the event date.
update atlas.worker_day_cues cue
set expires_at=atlas.event_project_end_at_v1((cue.payload->>'dynamicProjectId')::uuid),
    recovery_policy='expire',
    updated_at=now()
where cue.cue_kind='briefing'
  and nullif(cue.payload->>'dynamicProjectId','') is not null
  and cue.payload->>'dynamicProjectId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
