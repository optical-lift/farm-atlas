create or replace function atlas.rhythm_boundary_at_v1(
  p_started_at timestamp with time zone,
  p_offset_seconds integer,
  p_timezone_name text default 'America/Chicago'::text,
  p_boundary_mode text default 'exact_timestamp'::text
)
returns timestamp with time zone
language sql
stable
set search_path to 'pg_catalog'
as $function$
  select case
    when p_started_at is null or p_offset_seconds is null then null
    when coalesce(p_boundary_mode,'exact_timestamp')='local_calendar_day' then
      (
        date_trunc('day', p_started_at at time zone coalesce(nullif(p_timezone_name,''),'America/Chicago'))
        + make_interval(days => (greatest(p_offset_seconds,0) / 86400)::integer)
        + make_interval(secs => (greatest(p_offset_seconds,0) % 86400)::integer)
      ) at time zone coalesce(nullif(p_timezone_name,''),'America/Chicago')
    when coalesce(p_boundary_mode,'exact_timestamp') in ('local_wall_clock','local_day') then
      ((p_started_at at time zone coalesce(nullif(p_timezone_name,''),'America/Chicago'))
        + make_interval(secs => p_offset_seconds))
        at time zone coalesce(nullif(p_timezone_name,''),'America/Chicago')
    else p_started_at + make_interval(secs => p_offset_seconds)
  end
$function$;

do $patch$
declare d text; p text;
begin
  select pg_get_functiondef('atlas.ensure_rhythm_task_v1_base(uuid,text,timestamp with time zone)'::regprocedure) into d;

  p:=replace(
    d,
    E'    ''work_class'', nullif(v_template ->> ''workClass'', ''''),\n    ''task_series_key'',',
    E'    ''work_class'', nullif(v_template ->> ''workClass'', ''''),\n    ''work_lane'', nullif(v_template ->> ''workLane'', ''''),\n    ''task_series_key'','
  );
  if p=d then raise exception 'ensure_rhythm_task_v1_base workLane seam drifted'; end if;
  d:=p;

  p:=replace(
    d,
    E'    ''metadata'', jsonb_build_object(\n      ''rhythm_state_id'', v_state.id,',
    E'    ''metadata'', coalesce(v_template -> ''metadata'', ''{}''::jsonb) || jsonb_build_object(\n      ''rhythm_state_id'', v_state.id,'
  );
  if p=d then raise exception 'ensure_rhythm_task_v1_base template metadata seam drifted'; end if;
  execute p;
end $patch$;

update atlas.rhythm_rules
set version=2,
    warning_window_seconds=0,
    owner_reason='Owner correction: Grow Room Care is a daily farm-calendar obligation. Completion time must not drift the next day later, and biological care remains Sunday-eligible.',
    metadata=coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'boundaryMode','local_calendar_day',
        'timezoneName','America/Chicago',
        'timeClaimsPhysicalCondition',false,
        'calendarDayObligation',true,
        'calendarDayPolicy','one_round_per_local_farm_day'
      ),
    failure_consequence=jsonb_set(
      jsonb_set(
        coalesce(failure_consequence,'{}'::jsonb),
        '{dueTask}',
        coalesce(failure_consequence->'dueTask','{}'::jsonb)
          || jsonb_build_object(
            'workLane','required',
            'metadata',jsonb_build_object(
              'allow_sunday',true,
              'work_lane','required',
              'work_window_key','morning',
              'window_key','morning',
              'display_action','Care round',
              'display_subject','Grow Room',
              'display_location','Grow Room',
              'collection_zone','Grow Room',
              'commitment_kind','persistent',
              'executor_role','farm_hand',
              'manual_top_level_card',true,
              'round_completion_required',true,
              'calendar_day_obligation',true
            )
          ),
        true
      ),
      '{failureTask}',
      coalesce(failure_consequence->'failureTask',failure_consequence->'dueTask','{}'::jsonb)
        || jsonb_build_object(
          'workLane','required',
          'metadata',jsonb_build_object(
            'allow_sunday',true,
            'work_lane','required',
            'work_window_key','morning',
            'window_key','morning',
            'display_action','Care round',
            'display_subject','Grow Room',
            'display_location','Grow Room',
            'collection_zone','Grow Room',
            'commitment_kind','persistent',
            'executor_role','farm_hand',
            'manual_top_level_card',true,
            'round_completion_required',true,
            'calendar_day_obligation',true
          )
        ),
      true
    ),
    updated_at=now()
where rule_key='elm_grow_room_care_daily'
  and rhythm_key='grow_room_care'
  and status='active';

-- Re-evaluate every live state bound to this canonical rule. This is replay-safe
-- across environments where generated UUIDs differ.
do $evaluate$
declare state_row record;
begin
  for state_row in
    select state.id
    from atlas.rhythm_state state
    join atlas.rhythm_rules rule on rule.id=state.rhythm_rule_id
    where rule.rule_key='elm_grow_room_care_daily'
      and rule.rhythm_key='grow_room_care'
      and rule.status='active'
  loop
    perform atlas.evaluate_rhythm_binding_v1(
      state_row.id,
      now(),
      'grow_room_calendar_day_repair_v1'
    );
  end loop;
end $evaluate$;