-- The weed-stewardship Clock may age, but elapsed time is not physical weed
-- evidence. Keep the existing rhythm task engine intact behind one physical-
-- need gate so a clear Weed Card cannot become assigned Weed work.

ALTER FUNCTION atlas.ensure_rhythm_task_v1(uuid, text, timestamptz)
  RENAME TO ensure_rhythm_task_without_physical_gate_v1;

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

-- Rhythm occurrences carry the state rather than the maintenance-object id.
-- Give them the same canonical title before they are released.
CREATE OR REPLACE FUNCTION atlas.canonicalize_weed_occurrence_title_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_object_id uuid;
  v_object_label text;
BEGIN
  IF NEW.source_kind = 'maintenance_weeding_collection' AND NEW.source_id IS NOT NULL THEN
    SELECT maintenance.object_id
    INTO v_object_id
    FROM atlas.maintenance_objects maintenance
    WHERE maintenance.id = NEW.source_id;
  ELSIF NEW.source_kind = 'rhythm_state' AND NEW.source_id IS NOT NULL THEN
    SELECT state.subject_id
    INTO v_object_id
    FROM atlas.rhythm_state state
    WHERE state.id = NEW.source_id
      AND state.rhythm_key = 'weed_stewardship'
      AND state.subject_kind = 'growing_object';
  ELSE
    RETURN NEW;
  END IF;

  IF v_object_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT object.label
  INTO v_object_label
  FROM atlas.growing_objects object
  WHERE object.id = v_object_id;

  IF v_object_label IS NOT NULL THEN
    NEW.title := 'Weed ' || v_object_label;
    NEW.task_payload := jsonb_set(
      coalesce(NEW.task_payload, '{}'::jsonb),
      '{title}',
      to_jsonb(NEW.title),
      true
    );
    NEW.task_payload := jsonb_set(
      NEW.task_payload,
      '{metadata}',
      coalesce(NEW.task_payload -> 'metadata', '{}'::jsonb)
        || jsonb_build_object(
          'display_title', NEW.title,
          'display_action', 'Weed',
          'display_subject', v_object_label,
          'target_object_id', v_object_id,
          'canonical_weed_title', true
        ),
      true
    );
  END IF;

  RETURN NEW;
END;
$function$;

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
  ) THEN
    RAISE EXCEPTION 'Internal rhythm task creation was exposed to authenticated clients.';
  END IF;
END;
$verify$;
