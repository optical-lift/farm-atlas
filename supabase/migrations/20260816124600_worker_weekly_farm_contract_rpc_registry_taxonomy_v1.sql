-- Keep Pass 3G RPC registry metadata inside Atlas's established classification taxonomy.

update atlas.authenticated_rpc_registry
set classification='owner_admin_endpoint', reviewed_at=now()
where signature='atlas.owner_weekly_farm_contract_api_v1(uuid, uuid, date)';

update atlas.authenticated_rpc_registry
set classification='app_endpoint', reviewed_at=now()
where signature='atlas.worker_self_weekly_farm_contract_api_v1(uuid, uuid, date)';
