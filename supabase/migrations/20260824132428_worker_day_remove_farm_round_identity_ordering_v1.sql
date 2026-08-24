create or replace function atlas.worker_task_day_window_v1(p_action_key text, p_task_type text, p_metadata jsonb)
returns text
language sql
immutable
as $function$
  select case
    when lower(coalesce(p_metadata->>'day_window','')) in ('morning','afternoon','evening')
      then lower(p_metadata->>'day_window')
    when lower(coalesce(p_metadata->>'work_window_key','')) in ('morning','afternoon','evening')
      then lower(p_metadata->>'work_window_key')
    when lower(coalesce(p_metadata->>'daypart','')) in ('morning','afternoon','evening')
      then lower(p_metadata->>'daypart')
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('top','morning','upper','first') then 'morning'
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('midday','midday_flex','visibility','visibility_prep','anchored','afternoon') then 'afternoon'
    when lower(coalesce(p_metadata->>'work_order_anchor','')) in ('evening','lower','bottom','last','last_thing') then 'evening'
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
$function$;

create or replace function atlas.worker_task_order_v1(p_action_key text, p_task_type text, p_metadata jsonb)
returns integer
language plpgsql
immutable
as $function$
declare
  v_explicit integer;
  v_window text;
  v_day_order integer:=0;
begin
  begin
    v_explicit:=coalesce(
      nullif(p_metadata->>'day_work_order','')::integer,
      nullif(p_metadata->>'work_order','')::integer,
      nullif(p_metadata->>'day_order_override','')::integer,
      nullif(p_metadata->>'run_sheet_order','')::integer
    );
  exception when invalid_text_representation then
    v_explicit:=null;
  end;
  if v_explicit is not null then return v_explicit; end if;
  begin
    v_day_order:=greatest(0,least(coalesce(nullif(p_metadata->>'day_order','')::integer,0),999));
  exception when invalid_text_representation then
    v_day_order:=0;
  end;
  v_window:=atlas.worker_task_day_window_v1(p_action_key,p_task_type,p_metadata);
  return case v_window when 'morning' then 22000 when 'evening' then 76000 else 42000 end + v_day_order;
end;
$function$;