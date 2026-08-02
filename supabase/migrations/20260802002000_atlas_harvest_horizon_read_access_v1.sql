begin;

-- The Harvest Horizon forecast view executes with the caller's rights so the
-- existing farm-membership RLS policies on its source tables remain in force.
alter view atlas.crop_cycle_yield_forecast set (security_invoker = true);
grant select on atlas.crop_cycle_yield_forecast to authenticated;

-- Crop observations are canonical field evidence. Farm operators may read
-- observations for authorized farms; writes remain behind reviewed RPCs.
grant select on atlas.crop_observations to authenticated;

drop policy if exists crop_observations_read_operations on atlas.crop_observations;
create policy crop_observations_read_operations
on atlas.crop_observations
for select
to authenticated
using (atlas.can_read_farm_operations(farm_id));

commit;
