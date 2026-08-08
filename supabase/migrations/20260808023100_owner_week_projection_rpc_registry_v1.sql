insert into atlas.authenticated_rpc_registry (
  function_signature,
  authenticated_execute_expected,
  classification,
  review_confidence,
  status,
  notes
)
values (
  'atlas.refresh_owner_week_projection_v1(uuid, uuid, date, integer)',
  true,
  'owner_admin_endpoint',
  'verified',
  'active',
  'Owner-facing weekly projection refresh. Plans future work without releasing it into the farm-hand day.'
)
on conflict (function_signature) do update
set authenticated_execute_expected = excluded.authenticated_execute_expected,
    classification = excluded.classification,
    review_confidence = excluded.review_confidence,
    status = excluded.status,
    notes = excluded.notes;
