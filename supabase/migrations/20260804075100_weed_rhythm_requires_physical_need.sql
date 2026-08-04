-- The weed-stewardship Clock may age, but elapsed time is not physical weed
-- evidence. Keep the existing rhythm task engine intact behind one physical-
-- need gate so a clear Weed Card cannot become assigned Weed work.

ALTER FUNCTION atlas.ensure_rhythm_task_v1(uuid, text, timestamptz)
  RENAME TO ensure_rhythm_task_without_physical_gate_v1;

-- The renamed implementation is an internal bypass seam. It must remain
-- callable only by its owning SECURITY DEFINER wrapper, never by an API role.
REVOKE ALL ON FUNCTION atlas.ensure_rhythm_task_without_physical_gate_v1(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION atlas.ensure_rhythm_task_v1(
  p_state_id uuid,
  p_target_state text,
  p_boundary_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_state atlas.rhythm_state%ROWTYPE;
BEGIN
  SELECT state.*
  INTO v_state
  FROM atlas.rhythm_state state
  WHERE state.id = p_state_id;

  IF v_state.id IS NULL THEN
    RAISE EXCEPTION 'Rhythm state not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_state.rhythm_key = 'weed_stewardship'
    AND v_state.subject_kind = 'growing_object'
    AND NOT atlas.weed_card_allows_ordinary_work_v1(
      v_state.subject_id,
      (coalesce(p_boundary_at, now()) at time zone 'America/Chicago')::date
    )
  THEN
    RETURN jsonb_build_object(
      'taskId', null,
      'occurrenceId', null,
      'action', 'physical_weed_need_not_present',
      'objectId', v_state.subject_id,
      'clockState', p_target_state
    );
  END IF;

  RETURN atlas.ensure_rhythm_task_without_physical_gate_v1(
    p_state_id,
    p_target_state,
    p_boundary_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION atlas.ensure_rhythm_task_v1(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

DO $verify$
BEGIN
  IF position(
    'physical_weed_need_not_present'
    IN pg_get_functiondef('atlas.ensure_rhythm_task_v1(uuid,text,timestamptz)'::regprocedure)
  ) = 0 THEN
    RAISE EXCEPTION 'Weed rhythm task creation is missing its physical-need gate.';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'atlas.ensure_rhythm_task_v1(uuid,text,timestamptz)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'atlas.ensure_rhythm_task_without_physical_gate_v1(uuid,text,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'A rhythm task creation seam is exposed to authenticated clients.';
  END IF;

  IF has_function_privilege(
    'service_role',
    'atlas.ensure_rhythm_task_without_physical_gate_v1(uuid,text,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'The physical-need bypass is exposed to service_role.';
  END IF;
END;
$verify$;
