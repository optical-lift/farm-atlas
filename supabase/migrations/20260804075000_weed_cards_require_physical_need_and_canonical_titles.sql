-- A Weed Card is physical work, not a calendar alarm. Clear beds stay out of
-- Work until field truth changes, and every serving uses one canonical title:
-- Weed [bed name].

CREATE OR REPLACE FUNCTION atlas.weed_card_allows_ordinary_work_v1(
  p_object_id uuid,
  p_as_of date DEFAULT current_date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_condition text;
BEGIN
  IF NOT atlas.care_strategy_allows_ordinary_weeding_v1(p_object_id, p_as_of) THEN
    RETURN false;
  END IF;

  SELECT card.current_condition
  INTO v_condition
  FROM atlas.weed_cards card
  WHERE card.object_id = p_object_id;

  IF v_condition = 'clear' THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION atlas.guard_care_strategy_weeding_occurrence_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_object_id uuid;
BEGIN
  IF NEW.source_kind = 'maintenance_weeding_collection'
    AND NEW.source_id IS NOT NULL
    AND NEW.state IN ('planned', 'eligible', 'failed', 'releasing')
  THEN
    SELECT object_id INTO v_object_id
    FROM atlas.maintenance_objects
    WHERE id = NEW.source_id;

    IF v_object_id IS NOT NULL
      AND NOT atlas.weed_card_allows_ordinary_work_v1(
        v_object_id,
        coalesce(NEW.planned_due_date, current_date)
      )
    THEN
      NEW.state := 'cancelled';
      NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'cancelled_by', 'weed_physical_need_guard',
          'cancelled_at', now(),
          'cancelled_reason', 'The persistent Weed Card is physically clear or its care strategy suppresses ordinary weeding.'
        );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION atlas.guard_care_strategy_weeding_task_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_object_id uuid;
BEGIN
  IF NEW.generated_from = 'maintenance_weeding_collection'
    AND NEW.generated_from_id IS NOT NULL
    AND NEW.status IN ('open', 'blocked')
  THEN
    SELECT object_id INTO v_object_id
    FROM atlas.maintenance_objects
    WHERE id = NEW.generated_from_id;

    IF v_object_id IS NOT NULL
      AND NOT atlas.weed_card_allows_ordinary_work_v1(
        v_object_id,
        coalesce(NEW.due_date, current_date)
      )
    THEN
      IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION
          'Ordinary weeding is not allowed without current physical need.'
          USING ERRCODE = '23514';
      END IF;

      NEW.status := 'skipped';
      NEW.completed_at := coalesce(NEW.completed_at, now());
      NEW.completed_by := coalesce(NEW.completed_by, 'weed_physical_need_guard');
      NEW.blocker_text := null;
      NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'suppressed_by', 'weed_physical_need_guard',
          'suppressed_at', now(),
          'suppressed_reason', 'The persistent Weed Card is physically clear or its care strategy suppresses ordinary weeding.'
        );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION atlas.canonicalize_weed_task_title_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_object_id uuid;
  v_card_id uuid;
  v_maintenance_id uuid;
  v_object_label text;
BEGIN
  IF NOT (
    lower(coalesce(NEW.action_key, '')) IN ('weed', 'weeding')
    OR lower(coalesce(NEW.task_type, '')) IN ('weed', 'weeding')
    OR lower(coalesce(NEW.metadata ->> 'work_route', '')) IN ('weed', 'weeding')
    OR coalesce(NEW.metadata ->> 'maintenance_type', '') = 'weed'
    OR coalesce(NEW.metadata ->> 'weed_card_managed', 'false') = 'true'
    OR NEW.title ~* '^weed\b'
  ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_object_id := nullif(NEW.metadata ->> 'target_object_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_object_id := null;
  END;

  IF v_object_id IS NULL THEN
    BEGIN
      v_card_id := nullif(NEW.metadata ->> 'weed_card_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_card_id := null;
    END;
    IF v_card_id IS NOT NULL THEN
      SELECT object_id INTO v_object_id
      FROM atlas.weed_cards
      WHERE id = v_card_id;
    END IF;
  END IF;

  IF v_object_id IS NULL THEN
    BEGIN
      v_maintenance_id := nullif(NEW.metadata ->> 'maintenance_object_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_maintenance_id := null;
    END;
    IF v_maintenance_id IS NOT NULL THEN
      SELECT object_id INTO v_object_id
      FROM atlas.maintenance_objects
      WHERE id = v_maintenance_id;
    END IF;
  END IF;

  IF v_object_id IS NULL
    AND NEW.generated_from = 'maintenance_weeding_collection'
    AND NEW.generated_from_id IS NOT NULL
  THEN
    SELECT object_id INTO v_object_id
    FROM atlas.maintenance_objects
    WHERE id = NEW.generated_from_id;
  ELSIF v_object_id IS NULL
    AND NEW.generated_from = 'weed_card'
    AND NEW.generated_from_id IS NOT NULL
  THEN
    SELECT object_id INTO v_object_id
    FROM atlas.weed_cards
    WHERE id = NEW.generated_from_id;
  END IF;

  IF v_object_id IS NOT NULL THEN
    SELECT label INTO v_object_label
    FROM atlas.growing_objects
    WHERE id = v_object_id;
  END IF;

  v_object_label := coalesce(
    nullif(v_object_label, ''),
    nullif(NEW.metadata ->> 'display_subject', ''),
    nullif(NEW.metadata ->> 'collection_label', '')
  );

  IF v_object_label IS NOT NULL THEN
    NEW.title := 'Weed ' || v_object_label;
    NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'display_title', NEW.title,
        'display_action', 'Weed',
        'display_subject', v_object_label,
        'canonical_weed_title', true
      );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_canonicalize_weed_task_title_v1 ON atlas.tasks;
CREATE TRIGGER zz_canonicalize_weed_task_title_v1
BEFORE INSERT OR UPDATE OF title, task_type, action_key, metadata, generated_from, generated_from_id
ON atlas.tasks
FOR EACH ROW
EXECUTE FUNCTION atlas.canonicalize_weed_task_title_v1();

CREATE OR REPLACE FUNCTION atlas.canonicalize_weed_occurrence_title_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, atlas
AS $function$
DECLARE
  v_object_label text;
BEGIN
  IF NEW.source_kind <> 'maintenance_weeding_collection' OR NEW.source_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT object.label
  INTO v_object_label
  FROM atlas.maintenance_objects maintenance
  JOIN atlas.growing_objects object ON object.id = maintenance.object_id
  WHERE maintenance.id = NEW.source_id;

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
          'canonical_weed_title', true
        ),
      true
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_canonicalize_weed_occurrence_title_v1 ON atlas.planned_work_occurrences;
CREATE TRIGGER zz_canonicalize_weed_occurrence_title_v1
BEFORE INSERT OR UPDATE OF title, task_payload, source_kind, source_id
ON atlas.planned_work_occurrences
FOR EACH ROW
EXECUTE FUNCTION atlas.canonicalize_weed_occurrence_title_v1();

DO $repair$
DECLARE
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_object_id uuid;
  v_card_id uuid;
  v_pass_id uuid;
  v_task_id uuid;
  v_state atlas.rhythm_state%rowtype;
  v_satisfaction_id uuid;
  v_return_days integer := 21;
BEGIN
  SELECT object.id INTO v_object_id
  FROM atlas.growing_objects object
  JOIN atlas.farms farm ON farm.id = object.farm_id
  WHERE farm.stable_key = 'elm_farm'
    AND object.stable_key = 'fr_8';

  IF v_object_id IS NULL THEN RETURN; END IF;

  SELECT card.id INTO v_card_id
  FROM atlas.weed_cards card
  WHERE card.object_id = v_object_id;

  IF v_card_id IS NULL THEN RETURN; END IF;

  SELECT coalesce(maintenance.normal_return_interval_days, 21)
  INTO v_return_days
  FROM atlas.weed_cards card
  JOIN atlas.maintenance_objects maintenance ON maintenance.id = card.maintenance_object_id
  WHERE card.id = v_card_id;

  SELECT pass.id INTO v_pass_id
  FROM atlas.weed_passes pass
  WHERE pass.weed_card_id = v_card_id
    AND pass.status = 'active'
  ORDER BY pass.opened_at DESC
  LIMIT 1;

  SELECT task.id INTO v_task_id
  FROM atlas.tasks task
  JOIN atlas.task_objects link ON link.task_id = task.id
  WHERE link.object_id = v_object_id
    AND task.status IN ('open', 'blocked')
    AND (
      lower(coalesce(task.action_key, '')) IN ('weed', 'weeding')
      OR coalesce(task.metadata ->> 'weed_card_id', '') = v_card_id::text
    )
  ORDER BY task.created_at DESC
  LIMIT 1;

  IF v_pass_id IS NOT NULL THEN
    INSERT INTO atlas.weed_sessions (
      weed_card_id, weed_pass_id, task_id, work_date, minutes, minutes_known,
      condition_before, condition_after, note, idempotency_key, metadata
    ) VALUES (
      v_card_id, v_pass_id, v_task_id, v_today, 0, false, 'clear', 'clear',
      'Owner confirmed Field Row 8 was already weeded and remains clearer than beds that need work.',
      'owner-observation:elm:fr_8:' || v_today::text || ':already-clear',
      jsonb_build_object(
        'source', 'owner_current_physical_observation',
        'repair', 'weed_cards_require_physical_need_and_canonical_titles'
      )
    ) ON CONFLICT (idempotency_key) DO NOTHING;

    UPDATE atlas.weed_passes
    SET status = 'closed',
        current_condition = 'clear',
        closed_at = coalesce(closed_at, now()),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'closed_by', 'owner_current_physical_observation',
            'closed_reason', 'Bed was already weeded and physically clear.',
            'closed_observed_at', now()
          ),
        updated_at = now()
    WHERE id = v_pass_id;
  END IF;

  UPDATE atlas.weed_cards
  SET current_condition = 'clear',
      target_condition = 'clear',
      next_review_on = v_today + v_return_days,
      last_session_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'last_owner_observation', 'already weeded and clear',
          'last_owner_observed_at', now(),
          'physical_need_gate', true
        ),
      updated_at = now()
  WHERE id = v_card_id;

  UPDATE atlas.object_state
  SET weed_pressure = 'maintained',
      last_touched_at = greatest(coalesce(last_touched_at, v_today), v_today),
      last_weeded_at = greatest(coalesce(last_weeded_at, v_today), v_today),
      last_checked_at = greatest(coalesce(last_checked_at, v_today), v_today),
      care_state = 'settled',
      care_pressure = 'none',
      care_freshness = 'observed',
      care_observed_at = now(),
      care_source_kind = 'observation',
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'owner_observation', 'Field Row 8 is already weeded and clear.',
          'owner_observed_at', now(),
          'weed_card_condition', 'clear'
        ),
      updated_at = now()
  WHERE object_id = v_object_id;

  UPDATE atlas.maintenance_objects
  SET condition = 'maintained',
      last_completed_at = now(),
      next_eligible_date = v_today + v_return_days,
      condition_reported_at = now(),
      estimate_source = 'owner_current_physical_observation',
      active = true,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'weed_card_condition', 'clear',
          'physical_need_gate', true,
          'owner_observed_at', now()
        ),
      updated_at = now()
  WHERE object_id = v_object_id
    AND maintenance_type = 'weed';

  UPDATE atlas.tasks task
  SET status = 'skipped',
      completed_at = coalesce(task.completed_at, now()),
      completed_by = coalesce(task.completed_by, 'owner_current_physical_observation'),
      blocker_text = null,
      metadata = coalesce(task.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'skipped_reason', 'Bed was already weeded and physically clear.',
          'skipped_by', 'owner_current_physical_observation',
          'skipped_at', now()
        ),
      updated_at = now()
  WHERE task.id IN (
    SELECT linked.task_id FROM atlas.task_objects linked WHERE linked.object_id = v_object_id
  )
    AND task.status IN ('open', 'blocked')
    AND (
      lower(coalesce(task.action_key, '')) IN ('weed', 'weeding')
      OR coalesce(task.metadata ->> 'weed_card_id', '') = v_card_id::text
    );

  UPDATE atlas.planned_work_occurrences occurrence
  SET state = 'completed',
      metadata = coalesce(occurrence.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'completed_by', 'owner_current_physical_observation',
          'completed_reason', 'Bed was already weeded and physically clear.',
          'completed_at', now()
        ),
      updated_at = now()
  WHERE occurrence.released_task_id IN (
    SELECT linked.task_id
    FROM atlas.task_objects linked
    JOIN atlas.tasks task ON task.id = linked.task_id
    WHERE linked.object_id = v_object_id
      AND task.status = 'skipped'
      AND coalesce(task.metadata ->> 'weed_card_id', '') = v_card_id::text
  );

  SELECT state.* INTO v_state
  FROM atlas.rhythm_state state
  WHERE state.subject_kind = 'growing_object'
    AND state.subject_id = v_object_id
    AND state.rhythm_key = 'weed_stewardship'
  FOR UPDATE;

  IF v_state.id IS NOT NULL THEN
    INSERT INTO atlas.rhythm_satisfactions (
      organization_id, farm_id, rhythm_state_id, rhythm_binding_id,
      rhythm_rule_id, rhythm_key, subject_kind, subject_id,
      satisfaction_key, satisfaction_kind, satisfied_at, source_kind,
      source_event, source_object_id, policy_match, evidence
    ) VALUES (
      v_state.organization_id, v_state.farm_id, v_state.id,
      v_state.rhythm_binding_id, v_state.rhythm_rule_id, v_state.rhythm_key,
      v_state.subject_kind, v_state.subject_id,
      'owner-observation:elm:fr_8:' || v_today::text || ':clear',
      'owner_observation', now(), 'owner_current_physical_observation',
      'already_weeded_clear', v_object_id,
      jsonb_build_object(
        'matchKind', 'owner_current_physical_observation',
        'physicalCondition', 'clear'
      ),
      jsonb_build_object(
        'objectId', v_object_id,
        'weedCardId', v_card_id,
        'note', 'Owner confirmed the bed was already weeded and clear.'
      )
    )
    ON CONFLICT (farm_id, satisfaction_key) DO UPDATE
    SET evidence = atlas.rhythm_satisfactions.evidence || excluded.evidence
    RETURNING id INTO v_satisfaction_id;

    IF v_satisfaction_id IS NULL THEN
      SELECT satisfaction.id INTO v_satisfaction_id
      FROM atlas.rhythm_satisfactions satisfaction
      WHERE satisfaction.farm_id = v_state.farm_id
        AND satisfaction.satisfaction_key = 'owner-observation:elm:fr_8:' || v_today::text || ':clear';
    END IF;

    UPDATE atlas.rhythm_state
    SET last_qualifying_satisfaction_id = v_satisfaction_id,
        current_task_id = null,
        current_occurrence_id = null,
        recovery_started_at = null,
        updated_at = now()
    WHERE id = v_state.id;

    PERFORM atlas.evaluate_rhythm_binding_v1(
      v_state.id, now(), 'owner_current_physical_observation'
    );
  END IF;
END;
$repair$;

UPDATE atlas.tasks task
SET title = task.title,
    updated_at = task.updated_at
WHERE lower(coalesce(task.action_key, '')) IN ('weed', 'weeding')
   OR coalesce(task.metadata ->> 'weed_card_managed', 'false') = 'true';

DO $verify$
DECLARE
  v_object_id uuid;
BEGIN
  SELECT object.id INTO v_object_id
  FROM atlas.growing_objects object
  JOIN atlas.farms farm ON farm.id = object.farm_id
  WHERE farm.stable_key = 'elm_farm'
    AND object.stable_key = 'fr_8';

  IF EXISTS (
    SELECT 1
    FROM atlas.tasks task
    JOIN atlas.task_objects linked ON linked.task_id = task.id
    WHERE linked.object_id = v_object_id
      AND task.status IN ('open', 'blocked')
      AND lower(coalesce(task.action_key, '')) IN ('weed', 'weeding')
  ) THEN
    RAISE EXCEPTION 'Field Row 8 still has active Weed work after clear-state repair.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM atlas.tasks task
    WHERE lower(coalesce(task.action_key, '')) IN ('weed', 'weeding')
      AND EXISTS (
        SELECT 1 FROM atlas.task_objects linked WHERE linked.task_id = task.id
      )
      AND task.title !~ '^Weed .+'
  ) THEN
    RAISE EXCEPTION 'A linked Weed task still lacks the canonical Weed [bed name] title.';
  END IF;
END;
$verify$;
