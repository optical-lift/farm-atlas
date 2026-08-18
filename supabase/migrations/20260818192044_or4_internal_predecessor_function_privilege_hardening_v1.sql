revoke all on function atlas.production_lot_reforecast_preview_pre_or4_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function atlas.production_lot_reforecast_preview_pre_or4_v1(uuid,uuid) to service_role;

revoke all on function atlas.worker_state_transition_card_pre_or4_v2(uuid,uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_state_transition_card_pre_or4_v2(uuid,uuid,uuid,date) to service_role;