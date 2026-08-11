-- A first-open briefing is orientation, not another task inventory. Keep the
-- dynamic event cue short enough to answer what matters now without counting the
-- full downstream project chain into the worker's first screen.

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
  v_departure_label text;
  v_departure_action text;
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
    coalesce(bool_or(task.task_type='event_setup'),false)
  into v_remaining,v_setup
  from atlas.project_task_links link
  join atlas.tasks task on task.id=link.task_id
  where link.project_id=p_project_id
    and task.assigned_membership_id=p_membership_id
    and task.status in ('open','blocked')
    and coalesce(task.due_date,p_day)<=p_day
    and task.visibility_scope='assigned_worker';

  select
    coalesce(
      nullif(btrim(task.metadata->>'departure_label'),''),
      nullif(btrim(task.metadata->>'location_name'),''),
      nullif(btrim(task.metadata->>'display_location'),''),
      nullif(btrim(task.metadata->>'address'),'')
    ),
    case
      when task.task_type='harvest' then 'harvest'
      when task.task_type='field_work' then 'work'
      else coalesce(nullif(lower(btrim(task.metadata->>'display_action')),''),'work')
    end
  into v_departure_label,v_departure_action
  from atlas.project_task_links link
  join atlas.tasks task on task.id=link.task_id
  where link.project_id=p_project_id
    and task.assigned_membership_id=p_membership_id
    and task.status in ('open','blocked')
    and coalesce(task.due_date,p_day)<=p_day
    and task.visibility_scope='assigned_worker'
    and (
      nullif(btrim(task.metadata->>'departure_label'),'') is not null
      or nullif(btrim(task.metadata->>'address'),'') is not null
    )
  order by
    case when nullif(btrim(task.metadata->>'departure_label'),'') is not null then 0 else 1 end,
    task.due_date nulls last,
    task.created_at,
    task.id
  limit 1;

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

  if v_now_local::date>v_project.target_date then
    return 'The event has ended.';
  end if;

  if p_day=v_project.target_date
     and v_now_local::date=p_day
     and v_now_local>=v_end_local then
    return 'The event has ended.';
  end if;

  if p_day=v_project.target_date
     and v_now_local::date=p_day
     and v_now_local>=v_start_local then
    if v_remaining=0 then
      return 'The event is underway. Your assigned setup is finished.';
    end if;
    return 'The event is underway. Do only what still helps guests now.';
  end if;

  if p_day=v_project.target_date
     and v_now_local::date=p_day
     and v_minutes_to_start between 0 and 90 then
    if v_remaining=0 then
      return 'The event starts soon. Your assigned setup is already finished.';
    end if;
    return 'The event starts soon. Make guest arrival ready first.';
  end if;

  if v_remaining=0 then
    return 'Everything assigned to you for tonight is already finished.';
  end if;

  if p_day=v_project.target_date
     and v_now_local::date=p_day
     and v_now_local::time>=time '12:00'
     and v_departure_label is not null then
    if v_setup then
      return v_departure_label||' '||v_departure_action||' is still open. Elm setup follows.';
    end if;
    return v_departure_label||' '||v_departure_action||' is still open.';
  end if;

  if v_departure_label is not null and v_setup then
    return v_departure_label||' '||v_departure_action||' this morning. Elm setup afterward.';
  end if;
  if v_departure_label is not null then
    return v_departure_label||' '||v_departure_action||' is the first move.';
  end if;
  if v_setup then
    return 'Elm setup is what remains.';
  end if;
  return 'Your assigned event work is still open.';
end;
$function$;
