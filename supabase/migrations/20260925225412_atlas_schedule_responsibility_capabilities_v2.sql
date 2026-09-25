-- Production migration: 20260925225412_atlas_schedule_responsibility_capabilities_v2
-- Extend the universal institutional schedule responsibility with availability,
-- policy, and recurrence operations.

update reality.responsibility_relations
set permitted_operations=(
      select array_agg(distinct op order by op)
      from unnest(
        permitted_operations ||
        array[
          'availability.read','availability.manage',
          'policy.read','policy.manage',
          'recurrence.read','recurrence.write'
        ]::text[]
      ) op
    ),
    updated_at=now()
where responsibility_key='institutional_schedule_operations'
  and relation_state='active'
  and jurisdiction_kind='entity'
  and scope ? 'ledgerIds';
