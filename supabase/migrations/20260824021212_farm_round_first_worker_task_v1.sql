CREATE OR REPLACE FUNCTION atlas.worker_task_order_v1(p_action_key text, p_task_type text, p_metadata jsonb)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $function$
declare
  v_explicit integer;
  v_window text;
  v_day_order integer:=0;
begin
  -- Farm Round is the worker's opening stewardship shell and is always the
  -- first task of the day regardless of legacy order metadata.
  if lower(coalesce(p_metadata->>'farm_round_parent','false')) in ('true','yes','1')
     or coalesce(p_action_key,'')='farm_round'
     or coalesce(p_task_type,'')='stewardship_round'
  then
    return 0;
  end if;

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