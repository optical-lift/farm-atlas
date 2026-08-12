-- Keep Anna's current school/preschool enrollment card aligned with the
-- literal next work recorded on the live task. This is execution-copy
-- normalization only: it does not change the task's date or commitment.

do $$
declare
  v_updated integer;
begin
  update atlas.tasks t
  set metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'execution_do', 'Request the records + send the enrollment documents',
    'execution_how', jsonb_build_array(
      'Request the needed records from JSE.',
      'Email the enrollment documents that are ready to send.',
      'Look for the birth certificates needed for enrollment.'
    ),
    'execution_done_when', 'The JSE records are requested, the ready enrollment documents are emailed, and the birth certificates are either found or recorded as still missing.',
    'display_detail', 'JSE records · email documents · birth certificates',
    'worker_execution_normalized_at', now(),
    'worker_execution_normalized_source', 'school_enrollment_worker_packet_v1'
  ),
  updated_at = now()
  where t.farm_id = (
    select f.id
    from atlas.farms f
    where f.stable_key = 'elm_farm'
    limit 1
  )
    and t.metadata ->> 'task_key' = 'anna_20260805_school_preschool_enrollment'
    and t.title = 'School and Preschool Enrollment'
    and t.status in ('open', 'blocked');

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'Expected to normalize exactly one live School and Preschool Enrollment task; updated %.', v_updated;
  end if;
end $$;
