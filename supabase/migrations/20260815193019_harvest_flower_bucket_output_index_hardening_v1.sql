-- Harvest Pass 2 index hardening.
-- Cover the remaining foreign-key lookup on the append-only bucket ledger.

create index if not exists flower_harvest_bucket_observations_membership_date_idx
  on atlas.flower_harvest_bucket_observations(recorded_by_membership_id, observed_date desc);