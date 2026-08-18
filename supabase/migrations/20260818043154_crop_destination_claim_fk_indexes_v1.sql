create index if not exists crop_destination_claims_source_task_idx
  on atlas.crop_destination_claims(source_task_id);

create index if not exists crop_destination_claims_recorder_idx
  on atlas.crop_destination_claims(recorded_by_membership_id);