alter view atlas.v_crop_cycle_registry set (security_invoker = true);
grant select on atlas.v_crop_cycle_registry to authenticated;
revoke all on atlas.v_crop_cycle_registry from anon;
