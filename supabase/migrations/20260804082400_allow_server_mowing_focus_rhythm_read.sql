-- The task-focus page is rendered on the server through the Atlas service-role
-- client. Give that server seam only the six rhythm-state columns required to
-- render one mowing task; do not grant broad table access or mutation rights.

GRANT SELECT (
  id,
  subject_id,
  state,
  warning_at,
  due_at,
  failure_at
)
ON atlas.rhythm_state
TO service_role;

DO $verify$
BEGIN
  IF NOT (
    has_column_privilege('service_role', 'atlas.rhythm_state', 'id', 'SELECT')
    AND has_column_privilege('service_role', 'atlas.rhythm_state', 'subject_id', 'SELECT')
    AND has_column_privilege('service_role', 'atlas.rhythm_state', 'state', 'SELECT')
    AND has_column_privilege('service_role', 'atlas.rhythm_state', 'warning_at', 'SELECT')
    AND has_column_privilege('service_role', 'atlas.rhythm_state', 'due_at', 'SELECT')
    AND has_column_privilege('service_role', 'atlas.rhythm_state', 'failure_at', 'SELECT')
  ) THEN
    RAISE EXCEPTION 'The server mowing-focus read contract is incomplete.';
  END IF;

  IF has_table_privilege('service_role', 'atlas.rhythm_state', 'SELECT') THEN
    RAISE EXCEPTION 'The mowing-focus repair granted broad rhythm_state table access.';
  END IF;
END;
$verify$;
