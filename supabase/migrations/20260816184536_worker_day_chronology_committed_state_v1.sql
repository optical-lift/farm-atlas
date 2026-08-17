DO $patch$
DECLARE
  v_oid oid;
  v_def text;
  v_old text := $$when v_unplaced>0 then 'conflict'
      else 'proposed'$$;
  v_new text := $$when v_unplaced>0 then 'conflict'
      when jsonb_array_length(v_items)>0
       and not exists (
         select 1
         from jsonb_array_elements(v_items) item
         where coalesce(nullif(item->>'durationMinutes','')::integer,0)>0
           and coalesce(item->>'chronologyState','')<>'committed_timed'
       ) then 'committed'
      else 'proposed'$$;
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='atlas'
    AND p.proname='worker_day_chronology_overlay_v1'
    AND p.oid::regprocedure::text='atlas.worker_day_chronology_overlay_v1(uuid,uuid,date,jsonb)';
  IF v_oid IS NULL THEN RAISE EXCEPTION 'worker_day_chronology_overlay_v1 not found'; END IF;
  SELECT pg_get_functiondef(v_oid) INTO v_def;
  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION 'Expected chronology state fragment not found';
  END IF;
  v_def:=replace(v_def,v_old,v_new);
  EXECUTE v_def;
END
$patch$;