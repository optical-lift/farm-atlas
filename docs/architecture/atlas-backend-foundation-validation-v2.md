# Atlas Backend Foundation Validation V2

Validation-only marker for the exact current `main` head.

The build under test includes:

- canonical farm-object operational state
- Owner/Manager operational RLS reads
- role-aware day/week/month task schedules
- authenticated idempotent Quick Log writes
- authenticated Owner/Manager planting claims
- centralized API membership resolution
- operational state, schedule, Quick Log, and planting-claim API gateways

Validation rerun after the planting-catalog type boundary was made explicit.

This branch is not intended to be merged.
