-- Cut the Clock commit validator over to the same modern selected-day truth the Owner/Worker Day reads.
DO $patch$
DECLARE
  v_oid oid;
  v_def text;
  v_old text := 'v_plan := atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);';
  v_new text := 'v_plan := atlas.owner_worker_day_plan_api_v1(p_farm_id,p_membership_id,p_day);';
BEGIN
  SELECT p.oid INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='atlas'
    AND p.proname='owner_commit_worker_clock_plan_api_v1'
    AND p.oid::regprocedure::text='atlas.owner_commit_worker_clock_plan_api_v1(uuid,uuid,date,jsonb)';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'owner_commit_worker_clock_plan_api_v1 signature not found';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_def;
  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION 'Expected legacy plan-source line was not found in owner_commit_worker_clock_plan_api_v1';
  END IF;

  v_def := replace(v_def,v_old,v_new);
  EXECUTE v_def;
END
$patch$;

-- Worker-facing Next Up now means the first actual Clock action. The old held/overflow
-- presentation remains available as deferredWork instead of masquerading as "next".
CREATE OR REPLACE FUNCTION atlas.worker_self_day_plan_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog','atlas','auth'
AS $function$
DECLARE
  v_plan jsonb;
  v_timeline jsonb;
  v_ordered jsonb;
  v_deferred jsonb := '[]'::jsonb;
  v_first jsonb;
  v_decision jsonb;
  v_next jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated user required.' USING errcode='42501';
  END IF;
  IF p_day IS NULL THEN
    RAISE EXCEPTION 'A worker day is required.' USING errcode='22023';
  END IF;
  IF NOT EXISTS(
    SELECT 1
    FROM atlas.farm_memberships membership
    WHERE membership.id=p_membership_id
      AND membership.farm_id=p_farm_id
      AND membership.user_id=auth.uid()
      AND membership.active=true
      AND membership.role='farm_hand'
  ) THEN
    RAISE EXCEPTION 'The Farm Hand Worker Day plan may only be read by that active Farm Hand.' USING errcode='42501';
  END IF;

  v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  v_plan:=atlas.worker_day_selection_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=atlas.enrich_worker_day_plan_clock_capacity_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_deferred:=coalesce(v_plan->'nextUp','[]'::jsonb);
  v_plan:=jsonb_set(v_plan,'{suggestions}','[]'::jsonb,true);

  v_timeline:=atlas.worker_day_chronology_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_ordered:=atlas.worker_day_chronology_ordered_v1(v_timeline,p_day);

  SELECT item.value
  INTO v_first
  FROM jsonb_array_elements(coalesce(v_ordered->'items','[]'::jsonb)) WITH ORDINALITY item(value,ordinality)
  WHERE coalesce(item.value->>'chronologyState','') IN (
      'committed_timed','proposed','proposed_outside_preferred_window'
    )
    AND coalesce(nullif(item.value->>'durationMinutes','')::integer,0)>0
  ORDER BY item.ordinality
  LIMIT 1;

  IF v_first IS NOT NULL THEN
    v_next:=jsonb_build_array(
      v_first || jsonb_build_object(
        'nextUpReason','clock_sequence',
        'executableNow',true
      )
    );
  ELSE
    v_decision:=atlas.worker_next_up_v3(p_farm_id,p_membership_id,p_day);
    IF jsonb_typeof(v_decision->'nextUp')='object' THEN
      v_next:=jsonb_build_array(
        (v_decision->'nextUp') || jsonb_build_object(
          'nextUpReason','decision_engine',
          'executableNow',coalesce(v_decision->>'state','')='ready'
        )
      );
    ELSE
      v_next:='[]'::jsonb;
    END IF;
  END IF;

  v_plan:=jsonb_set(v_plan,'{deferredWork}',v_deferred,true);
  v_plan:=jsonb_set(v_plan,'{nextUp}',v_next,true);
  v_plan:=jsonb_set(v_plan,'{clockTimeline}',v_ordered,true);
  v_plan:=jsonb_set(v_plan,'{nextUpContractVersion}',to_jsonb('worker_self_next_up_v2'::text),true);
  v_plan:=jsonb_set(v_plan,'{contractVersion}',to_jsonb('worker_self_day_plan_v2'::text),true);
  RETURN v_plan;
END;
$function$;