begin;

-- Production received a narrow rhythm-family dedupe follow-up while the
-- Presented Work contract was being proven. The final definition is folded into
-- 20260802124000_atlas_presented_work_contract_v1.sql so fresh environments
-- already receive the corrected partitioning. This migration remains as an
-- explicit history marker and is intentionally idempotent.

commit;
