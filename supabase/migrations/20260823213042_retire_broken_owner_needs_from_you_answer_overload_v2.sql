-- Retire the earlier five-argument Owner answer overload. Its destination branch supplied
-- displacement_authority='owner', which is not a lawful crop_destination_claims value.
-- The corrected four-argument propagation membrane is the sole active Owner answer RPC.

revoke all on function atlas.answer_owner_needs_from_you_v1(uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
drop function atlas.answer_owner_needs_from_you_v1(uuid,text,uuid,text,text);

update atlas.authenticated_rpc_registry
set authenticated_execute_expected=false,
    anonymous_execute_expected=false,
    service_execute_expected=false,
    review_status='revoked',
    evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
      'retiredBy','retire_broken_owner_needs_from_you_answer_overload_v2',
      'retiredReason','Five-argument overload attempted unlawful displacement_authority owner; corrected four-argument propagation membrane is canonical.',
      'replacementSignature','atlas.answer_owner_needs_from_you_v1(uuid, text, uuid, text)'
    ),
    reviewed_at=now()
where signature='atlas.answer_owner_needs_from_you_v1(uuid, text, uuid, text, text)';