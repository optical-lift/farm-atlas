do $migration$
begin
  update atlas.tasks
  set status = 'archived',
      due_date = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'checklist_status', 'archived',
        'archived_reason', 'Superseded by the existing bed-specific child with spray readiness instructions.',
        'archived_at', now(),
        'duplicate_consolidation_source', 'atlas_operational_audit_20260721'
      ),
      updated_at = now()
  where id in (
    'b09ac98c-7b5a-49f8-9626-ea65859f3729'::uuid,
    '74a72a59-f71f-41bc-bca0-44b443712a43'::uuid,
    'f1526fbb-9a22-489c-bba9-21010ecec995'::uuid,
    'd902eb22-8297-4f02-bc82-543419d3007f'::uuid,
    'cc7b3c29-5429-4391-a35c-d4c25df7544d'::uuid,
    '6d68c5e8-7518-47de-8185-a882d61d39b9'::uuid
  );

  update atlas.tasks
  set generated_from = 'sowing_bed_checklist',
      generated_from_id = parent_task_id,
      engine_instance_key = 'sowing-bed:' || parent_task_id::text || ':' || (metadata->>'target_object_id'),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'is_child_task', true,
        'sowing_bed_subtask', true,
        'sowing_bed_object_id', metadata->>'target_object_id',
        'checklist_status', case when status='done' then 'done' else 'open' end,
        'canonical_checklist_promoted_at', now(),
        'canonical_checklist_promotion_source', 'preserve_existing_spray_readiness_child'
      ),
      updated_at = now()
  where id in (
    '3d446cdd-2dac-4e4f-814c-cf5774179119'::uuid,
    'd2427f8c-462a-4fb8-9d4c-591c377d6989'::uuid,
    '3dd3393c-3f6e-48d1-8e99-8b836735d476'::uuid,
    'a313a4e5-c3cd-4ef0-943b-79b07531dc2c'::uuid,
    '4179a45e-af56-4dc1-9e38-2d5d815d00a9'::uuid,
    '87792dcb-1170-439d-a9db-b4ea7196150d'::uuid
  );
end;
$migration$;
