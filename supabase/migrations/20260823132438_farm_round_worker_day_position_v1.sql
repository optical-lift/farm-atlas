create or replace function atlas.worker_task_day_window_v1(p_action_key text, p_task_type text, p_metadata jsonb)
returns text
language sql
immutable
as $$
  select case
    -- Explicit task truth always outranks a generic operation-family default.
    when lower(coalesce(p_metadata->>'work_window_key','')) in ('morning','afternoon','evening')
      then lower(p_metadata->>'work_window_key')
    when lower(coalesce(p_metadata->>'daypart','')) in ('morning','afternoon','evening')
      then lower(p_metadata->>'daypart')
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('top','morning','upper','first') then 'morning'
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('midday','midday_flex','visibility','visibility_prep','anchored','afternoon') then 'afternoon'
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('evening','lower','bottom','last','last_thing') then 'evening'

    -- Farm Round is the transition into the outdoor stewardship route, not an
    -- untimed afternoon card. Keep every generated Farm Round in the morning
    -- execution window without baking a date-specific placement into the task.
    when lower(coalesce(p_action_key,''))='farm_round'
      or lower(coalesce(p_task_type,''))='stewardship_round'
      or lower(coalesce(p_metadata->>'work_route',''))='farm_round' then 'morning'

    -- Generic operation defaults apply only after explicit temporal truth.
    when lower(coalesce(p_action_key,'')) in ('sow','seed')
      or lower(coalesce(p_task_type,'')) in ('sowing','succession_sowing')
      or lower(coalesce(p_metadata->>'work_rhythm',''))='seed_sowing' then 'evening'
    when lower(coalesce(p_metadata->>'work_route',''))='seed' then 'evening'
    when lower(coalesce(p_action_key,''))='mow'
      or lower(coalesce(p_metadata->>'work_collection_key',''))='mowing' then 'evening'
    when lower(coalesce(p_action_key,'')) in ('plant','transplant')
      or lower(coalesce(p_task_type,''))='transplanting' then 'evening'
    when lower(coalesce(p_action_key,''))='weed'
      or lower(coalesce(p_metadata->>'work_collection_key',''))='weeding' then 'morning'
    when lower(coalesce(p_action_key,''))='harvest'
      or lower(coalesce(p_task_type,''))='postharvest' then 'morning'
    when lower(coalesce(p_action_key,''))='water'
      or lower(coalesce(p_task_type,'')) in ('grow_room_care','germination_check') then 'morning'
    else 'afternoon'
  end;
$$;

comment on function atlas.worker_task_day_window_v1(text,text,jsonb) is
  'Canonical Worker Day temporal window resolver. Farm Round/stewardship round belongs to the morning stewardship route unless a task carries an explicit temporal override.';
