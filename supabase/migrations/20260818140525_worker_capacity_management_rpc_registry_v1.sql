insert into atlas.authenticated_rpc_registry(signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,service_execute_expected,caller_count,policy_reference_count,evidence,registered_at,reviewed_at)
values(
 'atlas.management_mark_worker_weekly_capacity_owner_decision_api_v1(uuid, uuid, date, text, text, text)',
 'owner_admin_endpoint','verified','active',true,true,true,0,1,
 jsonb_build_object(
   'purpose','Allow Farm Operations management to explicitly mark a current weekly labor-capacity conflict as leaving an ownership-level consequence unresolved.',
   'boundary','This is the only new Phase 11 action that grants a Principal escalation warrant; over-capacity alone remains contained in Farm Operations.'
 ),
 now(),now()
)
on conflict (signature) do update set classification=excluded.classification,confidence=excluded.confidence,review_status=excluded.review_status,
 authenticated_execute_expected=excluded.authenticated_execute_expected,security_definer_expected=excluded.security_definer_expected,
 service_execute_expected=excluded.service_execute_expected,evidence=excluded.evidence,reviewed_at=now();

update atlas.authenticated_rpc_registry set evidence=evidence||jsonb_build_object(
 'phase11','Now returns Weekly Farm Contract v6 with explicit fixed/protected/required/optional labor claims and physical-load capacity custody.'
) where signature in ('atlas.owner_weekly_farm_contract_api_v1(uuid, uuid, date)','atlas.worker_self_weekly_farm_contract_api_v1(uuid, uuid, date)');

update atlas.authenticated_rpc_registry set evidence=evidence||jsonb_build_object(
 'phase11','Now reads worker_weekly_capacity_conflict_v2; management conflict is not itself a Principal escalation warrant.'
) where signature='atlas.owner_worker_weekly_capacity_conflict_api_v1(uuid, uuid, date)';
