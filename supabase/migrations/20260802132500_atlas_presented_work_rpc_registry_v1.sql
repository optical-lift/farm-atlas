begin;

-- Production received a final authenticated RPC registry synchronization after
-- the Presented Work cutover. Fresh environments receive the same registry
-- entries inside the migrations that grant or revoke authenticated execution.
-- This history marker is intentionally idempotent.

commit;
